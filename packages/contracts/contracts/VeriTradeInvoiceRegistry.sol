// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VeriTradeInvoiceRegistry
 * @notice Globally keyed registry of invoice financing claims.
 *
 * The registry answers exactly one question: "is this invoice already claimed
 * for financing, and by whom?" It is deliberately small. It holds no funds,
 * performs no transfers, and makes no external calls.
 *
 * Lifecycle:
 *
 *     UNREGISTERED --register--> RESERVED --declareFinanced--> FINANCED --close--> CLOSED
 *                                    |
 *                                    +--cancelReservation--> UNREGISTERED
 *
 * A CLOSED claim is terminal and can never be re-registered, so a financed
 * invoice cannot be laundered into a fresh claim. A cancelled reservation was
 * never financed, so it may be registered again; the cancellation event is the
 * permanent record of the earlier attempt.
 *
 * IMPORTANT: FINANCED means "a holder of FINANCIER_ROLE declared that financing
 * was agreed". It is an attested declaration, not proof that funds moved. The
 * contract has no visibility into bank transfers and must never be read as
 * evidence of disbursement. Off-chain reconciliation is responsible for that.
 *
 * Identity: invoices are identified by a `bytes32 commitment` derived off-chain
 * from the canonical invoice identity (see docs/invoice-commitment-spec.md).
 * Only the commitment is stored; no raw invoice data, party name, tax id, bank
 * detail, line item or document ever reaches this contract.
 *
 * Duplicate detection is global. The commitment is the mapping key and carries
 * no organization scope, so two organizations submitting the same invoice
 * collide on the same slot by construction.
 */
contract VeriTradeInvoiceRegistry is AccessControl, Pausable {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @notice May reserve an invoice and cancel a reservation that was never financed.
    bytes32 public constant REGISTRAR_ROLE = keccak256("VT_REGISTRAR_ROLE");

    /// @notice May declare that financing was agreed and may close a financed claim.
    bytes32 public constant FINANCIER_ROLE = keccak256("VT_FINANCIER_ROLE");

    // ---------------------------------------------------------------------
    // Commitment encoding
    // ---------------------------------------------------------------------

    /// @notice Contract release version, for deployment bookkeeping.
    string public constant CONTRACT_VERSION = "1.0.0";

    /// @notice Domain separator mixed into every commitment.
    /// @dev A distinct domain keeps on-chain commitments unlinkable to the
    /// Phase 3 database fingerprint (`sha256` of the canonical identity) even
    /// for someone holding the same invoice.
    bytes32 public constant COMMITMENT_DOMAIN = keccak256("vt-invoice-commitment-v1");

    /// @notice Schema version of the identity canonicalization the digest uses.
    uint16 public constant SCHEMA_VERSION = 1;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ClaimStatus {
        UNREGISTERED,
        RESERVED,
        FINANCED,
        CLOSED
    }

    struct Claim {
        ClaimStatus status;
        uint16 schemaVersion;
        // Increments on every reservation of the same commitment. It lets an
        // indexer order successive attempts without trusting timestamps.
        uint32 generation;
        uint64 reservedAt;
        uint64 financedAt;
        uint64 closedAt;
        // Organization that submitted the reservation. Opaque on-chain handle;
        // never a database id in the clear.
        bytes32 entityId;
        address registrar;
        address financier;
        // Opaque, domain-separated handle of the off-chain financing request.
        bytes32 financingRef;
    }

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroCommitment();
    error ZeroEntityId();
    error ZeroFinancingRef();
    /// @notice The commitment already has an active (RESERVED or FINANCED) claim.
    error ClaimAlreadyActive(bytes32 commitment, ClaimStatus current);
    /// @notice The claim was financed and closed; it can never be claimed again.
    error ClaimIsTerminal(bytes32 commitment);
    /// @notice The transition requires a RESERVED claim.
    error NotReserved(bytes32 commitment, ClaimStatus current);
    /// @notice The transition requires a FINANCED claim.
    error NotFinanced(bytes32 commitment, ClaimStatus current);
    /// @notice Only the financier that declared the financing (or the admin) may close it.
    error NotDeclaringFinancier(bytes32 commitment, address caller);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(bytes32 commitment => Claim) private _claims;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event InvoiceReserved(
        bytes32 indexed commitment,
        bytes32 indexed entityId,
        address indexed registrar,
        uint32 generation,
        uint16 schemaVersion,
        uint64 blockTimestamp
    );

    event FinancingDeclared(
        bytes32 indexed commitment,
        address indexed financier,
        bytes32 financingRef,
        uint32 generation,
        uint64 blockTimestamp
    );

    event ReservationCancelled(
        bytes32 indexed commitment,
        bytes32 indexed entityId,
        address indexed registrar,
        address cancelledBy,
        uint32 generation,
        uint64 blockTimestamp
    );

    event ClaimClosed(
        bytes32 indexed commitment,
        address indexed closedBy,
        address indexed financier,
        uint32 generation,
        uint64 blockTimestamp
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /**
     * @param admin Receives DEFAULT_ADMIN_ROLE, which controls role grants,
     * revocations and pause. No other role is granted here: registrars and
     * financiers are assigned explicitly by the role-initialisation script.
     */
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Commitment helper
    // ---------------------------------------------------------------------

    /**
     * @notice Derives the on-chain commitment from an identity digest.
     * @dev Mirrors the encoding documented in docs/invoice-commitment-spec.md so
     * the backend can either call this view or reproduce it with viem. Exposed
     * as a pure function so the encoding can never drift between the two.
     * @param identityDigest SHA-256 of the canonical invoice identity string.
     */
    function commitmentFor(bytes32 identityDigest) public pure returns (bytes32) {
        return keccak256(abi.encode(COMMITMENT_DOMAIN, SCHEMA_VERSION, identityDigest));
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Reserves an invoice for financing.
     * @dev Reverts while any claim on the commitment is active, regardless of
     * which entity is submitting. This is the double-financing guard.
     * @return generation Reservation generation for this commitment.
     */
    function register(bytes32 commitment, bytes32 entityId)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (uint32 generation)
    {
        if (commitment == bytes32(0)) revert ZeroCommitment();
        if (entityId == bytes32(0)) revert ZeroEntityId();

        Claim storage claim = _claims[commitment];
        if (claim.status == ClaimStatus.RESERVED || claim.status == ClaimStatus.FINANCED) {
            revert ClaimAlreadyActive(commitment, claim.status);
        }
        if (claim.status == ClaimStatus.CLOSED) revert ClaimIsTerminal(commitment);

        // A previous reservation was cancelled, so the slot is reusable but the
        // generation keeps successive attempts distinguishable on-chain.
        generation = claim.generation + 1;

        claim.status = ClaimStatus.RESERVED;
        claim.schemaVersion = SCHEMA_VERSION;
        claim.generation = generation;
        claim.reservedAt = uint64(block.timestamp);
        claim.financedAt = 0;
        claim.closedAt = 0;
        claim.entityId = entityId;
        claim.registrar = msg.sender;
        claim.financier = address(0);
        claim.financingRef = bytes32(0);

        emit InvoiceReserved(
            commitment, entityId, msg.sender, generation, SCHEMA_VERSION, uint64(block.timestamp)
        );
    }

    /**
     * @notice Declares that financing was agreed for a reserved invoice.
     * @dev This records an attestation. It does not move funds and must not be
     * interpreted as evidence that a disbursement happened.
     * @param financingRef Opaque, domain-separated handle of the off-chain financing request.
     */
    function declareFinanced(bytes32 commitment, bytes32 financingRef)
        external
        onlyRole(FINANCIER_ROLE)
        whenNotPaused
    {
        if (financingRef == bytes32(0)) revert ZeroFinancingRef();

        Claim storage claim = _claims[commitment];
        if (claim.status != ClaimStatus.RESERVED) revert NotReserved(commitment, claim.status);

        claim.status = ClaimStatus.FINANCED;
        claim.financier = msg.sender;
        claim.financedAt = uint64(block.timestamp);
        claim.financingRef = financingRef;

        emit FinancingDeclared(
            commitment, msg.sender, financingRef, claim.generation, uint64(block.timestamp)
        );
    }

    /**
     * @notice Releases a reservation that was never financed.
     * @dev Only RESERVED claims may be cancelled. A FINANCED claim must be
     * closed instead, so a financed invoice can never silently become available
     * for a second financing round.
     */
    function cancelReservation(bytes32 commitment)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
    {
        Claim storage claim = _claims[commitment];
        if (claim.status != ClaimStatus.RESERVED) revert NotReserved(commitment, claim.status);

        bytes32 entityId = claim.entityId;
        address registrar = claim.registrar;
        uint32 generation = claim.generation;

        // Preserve the generation so the next reservation increments it; every
        // other field describes the reservation that just ended.
        claim.status = ClaimStatus.UNREGISTERED;
        claim.schemaVersion = 0;
        claim.reservedAt = 0;
        claim.financedAt = 0;
        claim.closedAt = 0;
        claim.entityId = bytes32(0);
        claim.registrar = address(0);
        claim.financier = address(0);
        claim.financingRef = bytes32(0);

        emit ReservationCancelled(
            commitment, entityId, registrar, msg.sender, generation, uint64(block.timestamp)
        );
    }

    /**
     * @notice Closes a financed claim, ending its lifecycle.
     * @dev Closing is restricted to the financier that declared the financing.
     * DEFAULT_ADMIN_ROLE is accepted as a recovery path for an offboarded key;
     * it can already grant itself any role, so this adds no new power.
     */
    function closeClaim(bytes32 commitment) external whenNotPaused {
        Claim storage claim = _claims[commitment];
        if (claim.status != ClaimStatus.FINANCED) revert NotFinanced(commitment, claim.status);

        if (msg.sender != claim.financier && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotDeclaringFinancier(commitment, msg.sender);
        }

        claim.status = ClaimStatus.CLOSED;
        claim.closedAt = uint64(block.timestamp);

        emit ClaimClosed(
            commitment, msg.sender, claim.financier, claim.generation, uint64(block.timestamp)
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function statusOf(bytes32 commitment) external view returns (ClaimStatus) {
        return _claims[commitment].status;
    }

    function claimOf(bytes32 commitment) external view returns (Claim memory) {
        return _claims[commitment];
    }

    /// @notice True while the invoice is RESERVED or FINANCED, i.e. not available.
    function isActive(bytes32 commitment) external view returns (bool) {
        ClaimStatus status = _claims[commitment].status;
        return status == ClaimStatus.RESERVED || status == ClaimStatus.FINANCED;
    }

    // ---------------------------------------------------------------------
    // Emergency controls
    // ---------------------------------------------------------------------

    /// @notice Stops every state transition. Existing records are untouched.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
