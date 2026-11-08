# Master plan — VeriTrade @ Team1 Vietnam UniHack 2026

**Lập ngày 2026-11-08.** Kế hoạch này nối tiếp thứ tự trong [roadmap.md](roadmap.md) và
[phase-4.5-backlog.md](phase-4.5-backlog.md), rồi gắn nó vào lịch và tiêu chí chấm của cuộc
thi. Trạng thái hiện tại luôn lấy từ [current-status.md](current-status.md); file này chỉ là
kế hoạch, không phải bằng chứng.

---

## 1. Cuộc thi

Nguồn: <https://team1vn.xyz/> (đọc ngày 2026-11-08).

| Mục            | Nội dung                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Hệ sinh thái   | Avalanche — chạy trên Avalanche L1, Fuji testnet hoặc C-Chain                                                             |
| Hạn nộp bài    | **23:59 ngày 21/11/2026 (giờ VN)** trên team1vn.xyz                                                                       |
| Final Demo Day | 30/11/2026, 09:00–11:30, Greenwich Vietnam (HCM); top 10 pitch trực tiếp                                                  |
| Bài nộp        | Repo GitHub (public, hoặc private + thêm `tuantqse90` làm collaborator), slide (Canva/Google Slides), video demo 2–3 phút |
| Theme gợi ý    | Social finance, Game on L1, AI agents & security, Agent economy on x402 (không bắt buộc)                                  |

**Thang điểm 100:** Technical Implementation 25 · **Avalanche Integration 25** · Creativity &
Innovation 15 · Impact & Use Case 15 · Presentation & Pitching 10 · **UI/UX & Demo 10**.

Hệ quả cho kế hoạch: backend đã mạnh (Technical), nhưng hai mục đang gần như bằng 0 là
**Avalanche Integration** (chưa deploy Fuji) và **UI/UX & Demo** (`apps/web` là shell). Đó là
hai việc chính của 13 ngày tới.

## 2. Dự án là gì (tóm tắt)

VeriTrade chống **tài trợ trùng hoá đơn** (double financing): doanh nghiệp tải hoá đơn điện tử
XML (TT78/2021, TT32/2011), hệ thống kiểm tra, rồi ghi một **commitment băm** của hoá đơn lên
Avalanche. Bên tài trợ đầu tiên reserve claim; bên thứ hai đăng ký cùng hoá đơn sẽ bị **chính
smart contract** từ chối. Không dữ liệu hoá đơn nào lên chain. Chi tiết:
[project-context.md](project-context.md).

Đã có (xem [current-status.md](current-status.md) §2):

- API NestJS: auth/JWT, multi-tenant, upload XML, 7 check xác minh, anchor, 4 route vòng đời
  claim, outbox + reconciler + indexer, quota ghi chain. 248 test pass trên PGlite **và**
  PostgreSQL 17.11 (chạy lại 2026-11-08).
- Contract `VeriTradeInvoiceRegistry.sol`: AccessControl + Pausable, đã test trên chain 31337.

Chưa có: deploy Fuji, giao diện, route tạo/liệt kê financing request, phân biệt tổ chức
supplier/financier, chấm điểm rủi ro.

## 3. Đối thủ và điểm khác biệt (cho slide)

| Sản phẩm                          | Loại            | Giống / khác VeriTrade                                                                                        |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| MonetaGo (Trade Finance Registry) | Web2 consortium | Cùng ý tưởng lưu fingerprint chống trùng; nhưng là mạng ngân hàng permissioned, không public chain            |
| Centrifuge                        | Web3 RWA        | Có chạy trên Avalanche; tài trợ theo pool, không kiểm tra trùng từng hoá đơn                                  |
| Polytrade                         | Web3 RWA        | Token hoá khoản phải thu + điểm rủi ro AI; gần nhất về luồng sản phẩm                                         |
| Defactor                          | Web3 credit     | Credit desk (facility, drawdown); tham khảo layout bảng + drawer                                              |
| Intain / Olea / POSCO             | Avalanche L1    | Token hoá khoản phải thu thật trên Avalanche (08/2026) — luận điểm "Avalanche đã được dùng cho trade finance" |
| Bizzi Financing, Validus, Lendbiz | Web2 Việt Nam   | Tài trợ dựa trên hoá đơn điện tử VN; không có lớp chống trùng liên tổ chức                                    |

Luận điểm cho pitch: we.trade, Marco Polo, Contour (consortium blockchain) đều đã đóng cửa
2022–2023; VeriTrade chọn thiết kế nhẹ — một registry hash trên public chain, không cần
consortium. Nguồn từng dòng nằm trong báo cáo nghiên cứu ngày 2026-11-08; mọi nhận định về
giao diện đối thủ **chưa được kiểm chứng bằng ảnh chụp**.

**Tham khảo UI:** Centrifuge (marketplace dạng card + hàng chỉ số), Defactor demo (bảng + drawer

- action), Polytrade (thẻ kết quả xác minh + luồng 4 bước). Timeline trạng thái kèm link
  Snowtrace thì không đối thủ nào có công khai — tự thiết kế.

## 4. Lộ trình

Nguyên tắc từ roadmap vẫn giữ: **cái gì ảnh hưởng tính đúng của claim làm trước cái hiển thị
nó.** Vì vậy bảo mật và deploy đi trước UI về mặt phụ thuộc, nhưng chạy song song về thời gian.

| Mốc | Ngày     | Việc                                        | Phụ thuộc                      | Điểm chấm được lợi |
| --- | -------- | ------------------------------------------- | ------------------------------ | ------------------ |
| M0  | 08–09/11 | Dọn docs (đã làm), quyết định SEC-0         | —                              | Technical          |
| M1  | 09–10/11 | SEC-0: xoá hoặc thêm auth cho `trade`       | Quyết định của anh             | Technical          |
| M2  | 09–12/11 | FUJI-1: deploy registry lên Fuji            | Ví deployer + lệnh "deploy"    | **Avalanche 25**   |
| M3  | 10–12/11 | API cho UI: tạo + liệt kê financing request | —                              | Technical, Demo    |
| M4  | 11–17/11 | WEB-1: giao diện demo                       | M3; M2 cho link Snowtrace thật | **UI/UX 10**, Demo |
| M5  | 16–18/11 | Hosting demo (API + Postgres + web)         | M2, M4                         | Demo               |
| M6  | 18–21/11 | README, slide, video 2–3', nộp bài          | M5                             | Presentation 10    |
| M7  | 22–30/11 | Sửa lỗi, tập pitch, (stretch) mục §6        | —                              | Demo Day           |

### M1 — SEC-0 (backlog, ưu tiên cao nhất)

Theo [phase-4.5-backlog.md](phase-4.5-backlog.md#sec-0--remove-the-unauthenticated-trade-surface).
Đề xuất **xoá** module `trade` (rẻ hơn, hết rủi ro), giữ model Prisma `Trade` và migration.
Nghiệm thu: `POST /api/trades` trả 404, `pnpm test` xanh, cập nhật current-status §6 và
AGENTS.md §9.

### M2 — FUJI-1 (cần anh duyệt)

Theo [fuji-deployment-runbook.md](fuji-deployment-runbook.md). AGENTS.md quy định: không deploy
nếu chưa có `CONFIRM_DEPLOY=fuji:43113` **và** một người nói "deploy".

1. Anh tạo ví deployer riêng cho testnet, xin AVAX Fuji (faucet: <https://team1vn.xyz/faucet.html>).
2. Đặt key vào `.env` (hoặc Environment settings của project) — không bao giờ vào code/chat.
3. `pnpm --filter @veritrade/contracts env:check` → deploy → init roles → verify Snowtrace.
4. Commit `deployments/43113.json` (chỉ địa chỉ + tx hash, không key).
5. Nối API: `AVALANCHE_CHAIN_ID=43113`, `VERITRADE_CONTRACT_ADDRESS`, bật indexer
   (`BLOCKCHAIN_INDEXER_INTERVAL_MS` > 0). Chạy một vòng anchor → reserve → declare → close thật.

### M3 — API còn thiếu cho UI

Hiện chỉ seed tạo được financing request. Thêm, trong module `financing-requests`:

- `POST /api/v1/financing-requests` — tạo từ một invoice đã verify (`PASSED`/`PARTIAL`),
  scope theo `organizationId` từ token.
- `GET /api/v1/financing-requests` — liệt kê, phân trang như `GET /invoices`.

Mỗi route có e2e test, cập nhật docs endpoint. Phân biệt supplier/financier ở mức schema là
quyết định sản phẩm — với demo, đề xuất chỉ phân biệt ở UI (một signer giữ cả hai role, đúng
như thiết kế hiện tại, và nói rõ điều đó khi pitch).

### M4 — WEB-1: giao diện demo

Luồng duy nhất cần đẹp: **upload → kết quả xác minh → anchor → reserve → declare → close**.

| Màn hình                 | Nội dung                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Đăng nhập / đăng ký      | Dùng `/auth/login`, `/auth/register`                                                                                    |
| Dashboard                | Hàng chỉ số + bảng hoá đơn (lọc theo trạng thái)                                                                        |
| Upload                   | Kéo thả XML; hiển thị lỗi 422 rõ ràng                                                                                   |
| Chi tiết hoá đơn         | Thẻ 7 check; `PARTIAL` hiển thị là "Đã xác minh (kiểm tra cục bộ)", không phải lỗi                                      |
| Anchor & claim           | Nút hành động theo trạng thái, timeline thao tác on-chain, link Snowtrace tx + contract                                 |
| Trang xác minh công khai | Nhập commitment → đọc `statusOf` trực tiếp từ contract Fuji bằng viem (không qua API) — điểm cộng Avalanche Integration |
| Demo chống trùng         | Tổ chức thứ hai upload cùng hoá đơn → contract từ chối — **khoảnh khắc chính của video**                                |

Ràng buộc: chỉ `NEXT_PUBLIC_*` vào trình duyệt; không thêm endpoint nhận key/calldata; không
nới CORS ngoài origin của web demo; không hiển thị `FINANCING_DECLARED` là "đã giải ngân".

### M5 — Hosting

API cần máy chạy liên tục + Postgres + ổ đĩa (lưu XML local), nên không chạy được serverless.
Web có thể lên Vercel. `CORS_ORIGIN` đặt đúng một origin của web. Nhà cung cấp: chờ anh chọn.

### M6 — Nộp bài (trước 23:59 21/11)

- README: vấn đề, kiến trúc, địa chỉ contract Fuji + link Snowtrace, cách chạy.
- Slide: vấn đề → giải pháp → demo → kiến trúc → đối thủ (§3) → hạn chế thật (§5).
- Video 2–3 phút theo kịch bản M4.
- Repo public hoặc thêm `tuantqse90`; kiểm tra mọi link mở được khi chưa đăng nhập.

## 5. Những điều không được nói quá khi pitch

Lấy từ AGENTS.md §9 và current-status §6:

- `PASSED` không đạt được — chưa có tích hợp cơ quan thuế; trạng thái thật là `PARTIAL`.
- "Financed" = bên tài trợ **tuyên bố** đồng ý tài trợ, không phải tiền đã chuyển.
- Không có chấm điểm rủi ro (`RiskAssessment` chỉ là model).
- Một signer giữ cả REGISTRAR và FINANCIER role.
- Chỉ testnet; mainnet bị validator từ chối và phải giữ nguyên.

## 6. Stretch (chỉ sau khi M6 xong)

- Avalanche L1 riêng qua Builder Console — cần mở validator cho chain id mới, phải có ADR.
- SEC-1 (rate limit login + upload), SEC-2 (quản lý key) theo current-status §9.
- Object storage thay `LocalDocumentStorage`.

## 7. Quyết định cần anh

1. SEC-0: **xoá** hay **thêm auth** cho `trade`?
2. Fuji: ai cung cấp ví deployer, và khi nào anh nói "deploy"?
3. UI: chọn reference để clone (nên chụp màn hình Centrifuge / Defactor demo / Polytrade bằng
   trình duyệt thật trước).
4. Hosting cho API + Postgres và web.
5. Có phân biệt supplier/financier ở schema không, hay chỉ ở UI cho demo?
