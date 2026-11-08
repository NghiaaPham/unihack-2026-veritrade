# UI reference

The web client's visual language follows the **Defactor demo console**
(<https://demo.defactor.com>, captured 2026-11-08), chosen because it is the closest public,
login-free dashboard to VeriTrade's flow: an asset owner manages credit "facilities" and a
compliance pack, and an investor browses verified borrowers. The product owner asked for a
layout clone, localised to Vietnamese, with colours to be changed later.

What is reused: layout, spacing, type scale, radii, shadows and component structure. What is
**not** reused: logos, photos, illustrations, brand names, marketing copy, or the AI chat widget.
VeriTrade's mark is its own (`components/shell.tsx`, `LogoMark`).

Other products reviewed and why they were not the template:

| Product        | Why not                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| Centrifuge app | Fund-level investing (pool cards), no per-invoice lifecycle                      |
| Polytrade      | Closest business model, but the app needs an account; only the landing is public |
| MonetaGo       | Closest anti-double-financing idea, no public UI                                 |

No open-source project with a permissive licence, real traction and full screens for this use
case was found (GitHub search, 2026-11-08).

## Screen mapping

| Defactor screen                | VeriTrade route       | Meaning                                          |
| ------------------------------ | --------------------- | ------------------------------------------------ |
| Persona picker                 | `/`                   | Choose supplier / public verifier / financier    |
| — (no equivalent)              | `/login`, `/register` | Real API auth, same dark "mesh" style            |
| Raise · Dashboard              | `/dashboard`          | Invoice counts, next due, recent invoices        |
| Raise · Facility Book          | `/invoices`           | Invoice book                                     |
| — (no equivalent)              | `/invoices/upload`    | XML upload (TT78 / TT32)                         |
| Raise · Facility detail        | `/invoices/[id]`      | Claim lifecycle: anchor, reserve, declare, close |
| Raise · Payments               | `/transactions`       | On-chain operations                              |
| Raise · Compliance             | `/verification`       | Verification runs per invoice                    |
| Raise · Compliance pack detail | `/verification/[id]`  | The 7 checks, limitations, verdict               |
| Raise · Profile                | `/profile`            | Organisation, session, network                   |
| Yield · Borrowers              | `/fund`               | Financing requests                               |
| Yield · Pool detail            | `/fund/[id]`          | Financier actions + claim timeline               |
| — (no equivalent)              | `/verify`             | Public `statusOf(commitment)` read via viem      |

## Tokens

Defined once in `apps/web/src/app/globals.css` (`@theme`). Change the brand here.

| Token                  | Value                             | Token     | Value                    |
| ---------------------- | --------------------------------- | --------- | ------------------------ |
| `bg`                   | `#F5F6F8`                         | `primary` | `rgb(90 91 235)`         |
| `surface`              | `#FFFFFF`                         | `success` | `rgb(26 158 101)`        |
| `surface2`             | `#F0F2F5`                         | `warning` | `rgb(225 163 37)`        |
| `line`                 | `#E6E9F0`                         | `error`   | `rgb(196 24 72)`         |
| `ink` / `muted` / `lo` | `#374151` / `#6B7280` / `#9CA3AF` | font      | Sora (Google Fonts, OFL) |

Status pill tones live in `components/ui/index.tsx` (`TONE_RGB`); Vietnamese labels and tones
for every API enum live in `lib/status.ts`.

## Domain rules the UI must keep

- `PARTIAL` verification is shown as "Đã xác minh cục bộ", never as an error.
- "Đã xác nhận tài trợ" (financing declared) is never worded as a disbursement.
- No risk score or yield is displayed unless it is real API data.
- Snowtrace links only for chain 43113 (`lib/chain.ts`); a local chain shows the bare hash.
