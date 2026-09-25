/**
 * Câu hỏi gợi ý ở bảng bên trang Chat bot (v1.19.0).
 *
 * Bên chat bot (dự án RAG VER2 GG) nạp tài liệu theo từng mảng; ở đây chia đúng theo các mảng đó thành 4 mục lớn.
 * NẠP XONG một mảng bên chat bot thì đổi `ready: true` của mục tương ứng — câu hỏi mẫu đã viết sẵn ở dưới.
 * Mục chưa nạp vẫn hiện trong danh sách (để mọi người biết sắp có) nhưng bấm không được, tránh hỏi ra câu trả lời rỗng.
 */
export type QuestionGroup = {
  name: string;
  questions: string[];
};
/** Tên cũ, giữ cho khỏi vỡ chỗ nào còn dùng. */
export type Specialty = QuestionGroup;

export type Topic = {
  key: string;
  /** Tên mục lớn, viết HOA cho dễ quét mắt. */
  label: string;
  /** Một dòng mô tả mục này tra được gì. */
  hint: string;
  /** Tài liệu đã nạp bên chat bot chưa. */
  ready: boolean;
  groups: QuestionGroup[];
};

export const SPECIALTIES: QuestionGroup[] = [
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


/** Tra cứu mã ICD-10 — tài liệu đã nạp 25/09/2026. */
export const ICD_GROUPS: QuestionGroup[] = [
  {
    name: 'Cách tra và quy tắc chọn mã',
    questions: [
      'ICD-10 gồm bao nhiêu chương, chia theo nguyên tắc nào?',
      'Khi người bệnh có nhiều chẩn đoán thì chọn mã chính thế nào?',
      'Đuôi .8 và .9 trong mã ICD-10 khác nhau ra sao?',
      'Khi nào dùng mã chữ U và mã có dấu † ‡?',
    ],
  },
  {
    name: 'Nội khoa thường gặp',
    questions: [
      'Mã ICD-10 của tăng huyết áp vô căn',
      'Mã ICD-10 của đái tháo đường týp 2 có biến chứng thận',
      'Mã ICD-10 của bệnh phổi tắc nghẽn mạn tính đợt cấp',
      'Mã ICD-10 của suy tim sung huyết',
      'Mã ICD-10 của loét dạ dày tá tràng có xuất huyết',
    ],
  },
  {
    name: 'Bệnh truyền nhiễm',
    questions: [
      'Mã ICD-10 của sốt xuất huyết Dengue có dấu hiệu cảnh báo',
      'Mã ICD-10 của lao phổi có bằng chứng vi khuẩn học',
      'Mã ICD-10 của viêm gan vi rút B mạn tính',
      'Mã ICD-10 của tay chân miệng',
    ],
  },
  {
    name: 'Ngoại khoa – chấn thương – ngộ độc',
    questions: [
      'Mã ICD-10 của gãy kín thân xương đùi',
      'Mã ICD-10 của vết thương hở vùng cẳng tay',
      'Mã ICD-10 của bỏng nhiệt độ II vùng bàn tay',
      'Mã ICD-10 của ngộ độc thuốc paracetamol',
      'Phân biệt mã nguyên nhân ngoại sinh (V, W, X, Y) dùng khi nào',
    ],
  },
  {
    name: 'Sản khoa – nhi khoa',
    questions: [
      'Mã ICD-10 của thai nghén bình thường theo dõi định kỳ',
      'Mã ICD-10 của sinh mổ do bất tương xứng đầu chậu',
      'Mã ICD-10 của vàng da sơ sinh do sữa mẹ',
      'Mã ICD-10 của tiêu chảy cấp ở trẻ em',
    ],
  },
  {
    name: 'Triệu chứng và khám sức khỏe',
    questions: [
      'Mã ICD-10 dùng cho khám sức khỏe định kỳ',
      'Mã ICD-10 của sốt chưa rõ nguyên nhân',
      'Mã ICD-10 của đau bụng vùng thượng vị',
      'Khi nào được phép dùng mã nhóm R (triệu chứng) làm chẩn đoán chính?',
    ],
  },
];

/** Quy chế – quy định của phòng khám. Chờ nạp tài liệu bên chat bot. */
export const REGULATION_GROUPS: QuestionGroup[] = [
  {
    name: 'Giờ làm việc – kỷ luật lao động',
    questions: [
      'Quy định về giờ làm việc, nghỉ giữa ca và đi trễ',
      'Trình tự xin nghỉ phép, nghỉ bù, đổi ca',
      'Quy định về trang phục và thẻ nhân viên',
    ],
  },
  {
    name: 'Hồ sơ bệnh án – lưu trữ',
    questions: [
      'Quy định ghi chép và hoàn thành hồ sơ bệnh án',
      'Thời hạn lưu trữ hồ sơ bệnh án theo quy định',
      'Ai được phép sao chụp hồ sơ bệnh án cho người bệnh?',
    ],
  },
  {
    name: 'Kê đơn – dược',
    questions: [
      'Quy chế kê đơn thuốc ngoại trú',
      'Quy định bảo quản và cấp phát thuốc gây nghiện, hướng thần',
      'Xử trí khi phát hiện thuốc gần hết hạn dùng',
    ],
  },
  {
    name: 'Kiểm soát nhiễm khuẩn – an toàn người bệnh',
    questions: [
      'Quy định vệ sinh tay và mang phương tiện phòng hộ',
      'Quy trình xử lý chất thải y tế theo nhóm',
      'Quy định báo cáo sự cố y khoa',
    ],
  },
];

/** Mô tả công việc theo vị trí. Chờ nạp tài liệu bên chat bot. */
export const JOB_GROUPS: QuestionGroup[] = [
  {
    name: 'Khối khám chữa bệnh',
    questions: [
      'Mô tả công việc của bác sĩ khám bệnh ngoại trú',
      'Nhiệm vụ của điều dưỡng trưởng khoa',
      'Mô tả công việc của điều dưỡng hành chính',
    ],
  },
  {
    name: 'Cận lâm sàng',
    questions: [
      'Mô tả công việc của kỹ thuật viên xét nghiệm',
      'Nhiệm vụ của kỹ thuật viên chẩn đoán hình ảnh',
      'Trách nhiệm kiểm chuẩn thiết bị hằng ngày thuộc về ai?',
    ],
  },
  {
    name: 'Hành chính – tiếp đón',
    questions: [
      'Mô tả công việc của nhân viên tiếp nhận – thu ngân',
      'Nhiệm vụ của nhân viên hành chính nhân sự',
      'Mô tả công việc của nhân viên kho – vật tư y tế',
    ],
  },
];

/**
 * Bốn mục lớn hiện ở bảng bên, theo đúng thứ tự hiển thị.
 * Thêm mảng tài liệu mới: thêm một mục vào đây, không cần sửa giao diện.
 */
export const TOPICS: Topic[] = [
  { key: 'icd', label: 'TRA CỨU MÃ ICD', hint: 'Tìm mã ICD-10 theo tên bệnh, quy tắc chọn mã', ready: true, groups: ICD_GROUPS },
  { key: 'chuyen-mon', label: 'CHUYÊN MÔN Y TẾ', hint: 'Quy trình kỹ thuật, phác đồ điều trị theo chuyên khoa', ready: true, groups: SPECIALTIES },
  { key: 'quy-che', label: 'QUY CHẾ – QUY ĐỊNH', hint: 'Quy chế, quy định nội bộ của phòng khám', ready: false, groups: REGULATION_GROUPS },
  { key: 'mo-ta-cong-viec', label: 'MÔ TẢ CÔNG VIỆC', hint: 'Nhiệm vụ, trách nhiệm theo từng vị trí', ready: false, groups: JOB_GROUPS },
];
