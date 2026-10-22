export function validateAuth({ register, name, email, password, confirm }: {
  register: boolean; name: string; email: string; password: string; confirm: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!email.trim()) errors.email = 'Vui lòng nhập email.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Email không hợp lệ.';
  if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
  if (register) {
    if (!name.trim()) errors.name = 'Vui lòng nhập họ và tên.';
    else if (Array.from(name.trim()).length > 100) errors.name = 'Họ và tên tối đa 100 ký tự.';
    if (Array.from(password).length < 8 || Array.from(password).length > 128) errors.password = 'Mật khẩu cần từ 8 đến 128 ký tự.';
    if (!confirm || confirm !== password) errors.confirm = 'Mật khẩu xác nhận chưa khớp.';
  }
  return errors;
}
