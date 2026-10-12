# 🎓 FAP GPA Calculator

Extension cho Chrome / Edge giúp sinh viên FPT University tính GPA ngay trên trang **Bảng điểm** của FAP (`fap.fpt.edu.vn/Report/Transcript`).

## Tính năng

- **GPA hiện tại**: tính từ điểm thật, kèm xếp loại (Xuất sắc / Giỏi / Khá / Trung bình).
- **GPA từng kỳ** và **GPA tích luỹ**: có biểu đồ và bảng chi tiết.
- **Dự tính GPA tốt nghiệp**:
  - Nhập điểm giả định cho môn chưa học, hoặc sửa thử điểm môn đã có.
  - Điền nhanh một điểm cho tất cả môn còn trống.
  - Đặt **mục tiêu GPA** để xem các tín chỉ còn lại cần đạt trung bình bao nhiêu.
- **Bật/tắt từng môn** khỏi GPA.
- Điểm thử được **lưu lại trên trình duyệt** của bạn.
- Tự đổi theo **chế độ sáng/tối** của FAP.

### Công thức

```
GPA = Σ (điểm môn × số tín chỉ) / Σ (số tín chỉ của các môn được tính)
```

Mặc định **không tính** vào GPA:
- Các môn có mã bắt đầu bằng `OTP`, `TRS`, `VOV`, `LAB`, `OJT`.
- Các môn trong bảng "Những môn ngoài khung chương trình".

## Cài đặt

1. Vào trang [**Releases**](../../releases/latest) và tải file `fap-gpa-calculator-v*.zip`.
2. Giải nén ra một thư mục cố định. Đừng xoá thư mục này sau khi cài.
3. Mở trang quản lý extension:
   - Chrome / Cốc Cốc / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
4. Bật **Developer mode**.
5. Bấm **Load unpacked** rồi chọn thư mục vừa giải nén (thư mục có file `manifest.json`).
6. Vào FAP → **Báo cáo học tập → Bảng điểm**. Khung **GPA Calculator** sẽ hiện ngay trên bảng điểm.

### Cập nhật bản mới

Tải zip mới và giải nén **đè** vào thư mục cũ. Sau đó vào trang extension, bấm nút ↻ **Reload** của extension.

## Quyền riêng tư

- Extension chỉ chạy trên trang Bảng điểm của FAP.
- Chỉ đọc bảng điểm hiển thị trên trang. **Không gửi dữ liệu đi bất kỳ đâu.**
- Điểm thử và tuỳ chọn được lưu bằng `chrome.storage.local` trên máy bạn.

## Lưu ý

Đây là công cụ cá nhân, **không phải sản phẩm chính thức của FPT University**. Kết quả chỉ mang tính tham khảo; GPA chính thức theo công bố của nhà trường.

Nếu FAP đổi giao diện khiến extension không chạy, hãy tạo [Issue](../../issues).

## License

[MIT](LICENSE)
