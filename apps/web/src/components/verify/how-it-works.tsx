import { Panel, SectionLabel } from '@/components/ui';

const STEPS = [
  {
    n: '1',
    title: 'Băm định danh hoá đơn',
    body: 'Mã số thuế bên bán, ký hiệu, số hoá đơn và mẫu số được chuẩn hoá rồi băm SHA-256. Ngày phát hành, bên mua và số tiền không tham gia, nên hoá đơn bị phát hành lại với số tiền khác vẫn cho cùng một định danh.',
  },
  {
    n: '2',
    title: 'Mã cam kết theo miền + phiên bản',
    body: 'Định danh được băm tiếp bằng keccak256 cùng nhãn miền và phiên bản schema. Chain chỉ nhận mã cam kết 32 byte, không nhận dữ liệu hoá đơn; đổi phiên bản sẽ tạo mã mới cho mọi hoá đơn.',
  },
  {
    n: '3',
    title: 'Contract chỉ chấp nhận một claim',
    body: 'Mã cam kết là khoá lưu trữ chung cho mọi tổ chức: khi đã có claim đang hoạt động, lần giữ chỗ thứ hai bị contract từ chối. Giới hạn: hai bên phải chuẩn hoá giống nhau, và ai biết đủ thông tin hoá đơn đều có thể tự tính mã để tra cứu.',
  },
];

export function HowItWorks() {
  return (
    <div>
      <SectionLabel>Cách hoạt động</SectionLabel>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <Panel key={s.n} className="p-5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-surface2 text-sm font-bold text-primary"
              aria-hidden
            >
              {s.n}
            </span>
            <h3 className="m-0 mt-4 text-sm font-bold text-ink">{s.title}</h3>
            <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted">{s.body}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
