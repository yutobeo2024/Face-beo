// Danh mục chuyên khoa gợi ý ở trang Chat bot (v1.17.0) — chép từ dự án chat bot (RAG VER2 GG, frontend/src/app/knowledge.ts).
// Nạp thêm tài liệu mới bên chat bot thì thêm một mục { name, questions } ở đây cho khớp.
export type Specialty = {
  name: string;
  questions: string[];
};

export const SPECIALTIES: Specialty[] = [
  {
    name: 'Hồi sức – Cấp cứu – Chống độc',
    questions: [
      'Kỹ thuật lấy bỏ dị vật đường thở bằng tay',
      'Quy trình chọc hút khí màng phổi cấp cứu',
      'Quy trình tạo nhịp tạm thời ngoài da',
    ],
  },
  {
    name: 'Thận nhân tạo – Lọc màng bụng',
    questions: [
      'Các bước thay dịch lọc màng bụng tại nhà',
      'Quy trình lọc máu cho trẻ em',
      'Quy trình tái sử dụng quả lọc, dây máu',
    ],
  },
  {
    name: 'Thận – Tiết niệu',
    questions: [
      'Nội soi bơm rửa bàng quang, bơm hóa chất',
      'Chọc hút dịch nang thận dưới hướng dẫn siêu âm',
      'Đặt catheter tĩnh mạch cảnh để lọc máu cấp cứu',
    ],
  },
  {
    name: 'Cơ Xương Khớp',
    questions: [
      'Quy trình chọc hút dịch khớp gối dưới hướng dẫn siêu âm',
      'Quy trình tiêm hội chứng đường hầm cổ tay',
      'Quy trình chọc hút bằng kim nhỏ để chẩn đoán',
    ],
  },
  {
    name: 'Tiêu hóa',
    questions: [
      'Quy trình nội soi thực quản – dạ dày – tá tràng',
      'Mở thông dạ dày bằng nội soi',
      'Nội soi can thiệp nong thực quản bằng bóng',
    ],
  },
  {
    name: 'Thần kinh',
    questions: [
      'Test chẩn đoán chết não bằng điện não đồ',
      'Điều trị trạng thái động kinh',
      'Xoa bóp phòng chống loét cho người bệnh',
    ],
  },
  {
    name: 'Mắt',
    questions: [
      'Đo nhãn áp bằng nhãn áp kế Schiotz',
      'Cắt bao sau bằng laser',
      'Nối thông túi lệ mũi có dùng nội soi',
    ],
  },
  {
    name: 'Nhi khoa – Sơ sinh',
    questions: [
      'Truyền dịch qua tủy xương',
      'Hạ tinh hoàn ẩn, tinh hoàn lạc chỗ một bên một thì',
      'Mở thông dạ dày kiểu Stamm',
    ],
  },
  {
    name: 'Tuần hoàn – Tim mạch',
    questions: [
      'Quy trình thông tim phải và trái',
      'Cấy máy phá rung tự động ICD loại một buồng',
      'Đo chỉ số cổ chân cánh tay ABI',
    ],
  },
  {
    name: 'Hô hấp – Bệnh phổi',
    questions: [
      'Nội soi phế quản ống mềm chẩn đoán',
      'Nội soi phế quản lấy dị vật',
      'Đánh giá mức độ nặng cơn hen phế quản bằng lưu lượng đỉnh kế',
    ],
  },
  {
    name: 'Nội tiết',
    questions: [
      'Nghiệm pháp dung nạp glucose đường uống cho phụ nữ mang thai',
      'Phẫu thuật cắt toàn bộ tuyến giáp',
      'Nghiệm pháp nhịn nước',
    ],
  },
  {
    name: 'Huyết học – Truyền máu',
    questions: [
      'Định nhóm máu hệ ABO tại giường bệnh',
      'Quy trình gạn bạch cầu điều trị',
      'Xét nghiệm co cục máu đông',
    ],
  },
  {
    name: 'Dị ứng – Miễn dịch lâm sàng',
    questions: [
      'Test lẩy da đặc hiệu với dị nguyên hô hấp',
      'Định lượng histamine',
      'Test kích thích với thuốc đường uống',
    ],
  },
  {
    name: 'Chẩn đoán hình ảnh – Y học hạt nhân',
    questions: [
      'Chụp X-quang xương cánh tay thẳng nghiêng',
      'Xạ hình chức năng thận',
      'Chụp và nút dị dạng thông động tĩnh mạch não số hóa xóa nền',
    ],
  },
  {
    name: 'Vi sinh',
    questions: [
      'Treponema pallidum nhuộm soi',
      'Kỹ thuật HPV PCR',
      'Kỹ thuật HIV DNA PCR',
    ],
  },
  {
    name: 'Hóa sinh',
    questions: [
      'Định lượng IgE đặc hiệu lông gà',
      'Định lượng dưỡng chấp',
      'Định tính Marijuana',
    ],
  },
  {
    name: 'Chấn thương chỉnh hình – Cột sống',
    questions: [
      'Nắn chỉnh hình tật chân chữ X',
      'Điều trị bảo tồn trật khớp gối',
      'Phẫu thuật giải phóng thần kinh ngoại biên',
    ],
  },
  {
    name: 'Phẫu thuật Tiết niệu',
    questions: [
      'Cắt toàn bộ thận và niệu quản',
      'Thắt tĩnh mạch tinh trên bụng',
      'Điều trị đái rỉ ở nữ bằng đặt miếng nâng niệu đạo TOT',
    ],
  },
  {
    name: 'Phẫu thuật tạo hình – Thẩm mỹ',
    questions: [
      'Phẫu thuật sửa sẹo co ngón tay bằng tạo hình chữ Z',
      'Phẫu thuật chỉnh sửa các biến chứng sau hút mỡ',
      'Phẫu thuật giãn da cấp tính vùng da đầu',
    ],
  },
  {
    name: 'Bỏng',
    questions: [
      'Cắt hoại tử toàn lớp khâu kín ở trẻ em',
      'Cắt sẹo ghép da dày toàn lớp kiểu Wolf-Krause',
      'Vật lý trị liệu phục hồi chức năng trong bỏng',
    ],
  },
  {
    name: 'Tâm thần',
    questions: [
      'Trắc nghiệm PANSS',
      'Trị liệu tăng cường động lực',
      'Trắc nghiệm rối loạn ám ảnh cưỡng bức Y-BOCS',
    ],
  },
  {
    name: 'Dinh dưỡng lâm sàng',
    questions: [
      'Quy trình khám và tư vấn dinh dưỡng',
      'Đánh giá và phân tích thành phần cơ thể',
      'Xây dựng chế độ dinh dưỡng nuôi dưỡng qua ống thông',
    ],
  },
  {
    name: 'Da liễu – Phong',
    questions: [
      'Điều trị sẹo lồi bằng tiêm triamcinolon trong tổn thương',
      'Điều trị hạt cơm bằng nitơ lỏng',
      'Điều trị bệnh da bằng PUVA toàn thân',
    ],
  },
  {
    name: 'Phụ sản – Hỗ trợ sinh sản',
    questions: [
      'Quy trình phẫu thuật lấy thai',
      'Bơm tinh trùng vào buồng tử cung (IUI)',
      'Hút buồng tử cung do rong kinh rong huyết',
    ],
  },
  {
    name: 'Ung bướu – Hóa trị',
    questions: [
      'Bơm vắc xin BCG vào bàng quang điều trị ung thư',
      'Quy trình tiêm hóa chất nội tủy',
      'Liệu pháp miễn dịch điều trị ung thư bằng tế bào CAR-T',
    ],
  },
  {
    name: 'Y học cổ truyền – Châm cứu',
    questions: [
      'Điện châm điều trị đau thần kinh tọa',
      'Xoa bóp bấm huyệt cho trẻ nhỏ',
      'Kỹ thuật chích tứ phùng',
    ],
  },
  {
    name: 'Răng Hàm Mặt',
    questions: [
      'Phẫu thuật nội soi lấy sỏi tuyến nước bọt',
      'Phẫu thuật tháo bỏ implant nha khoa',
      'Chiếu laser công suất thấp điều trị viêm lợi',
    ],
  },
  {
    name: 'Phục hồi chức năng',
    questions: [
      'Kỹ thuật sử dụng chân giả trên gối',
      'Kỹ thuật sử dụng nẹp cổ bàn chân (AFO)',
      'Tiêm botulinum toxin điều trị loạn trương lực cơ cổ',
    ],
  },
];
