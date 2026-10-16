export type Language = 'vi' | 'en' | 'fr' | 'ja';
export type Category = 'Lịch sử' | 'Kiến trúc' | 'Văn hóa' | 'Khám phá';
export type Translated = Record<Language, string>;
export type Place = {
  id: string; title: string; subtitle: Translated; description: Translated;
  category: Category; district: string; latitude: number; longitude: number;
  image: string; duration: number; rating: number; source?: "osm" | "backend" | "demo";
};

export const LANGS: {key: Language; label: string; voice: string; flag: string}[] = [
  { key: 'vi', label: 'Tiếng Việt', voice: 'vi-VN', flag: '🇻🇳' },
  { key: 'en', label: 'English', voice: 'en-US', flag: '🇬🇧' },
  { key: 'fr', label: 'Français', voice: 'fr-FR', flag: '🇫🇷' },
  { key: 'ja', label: '日本語', voice: 'ja-JP', flag: '🇯🇵' },
];

// Dữ liệu minh họa, không phải nội dung tải từ cơ sở dữ liệu thật.
// Tọa độ tham khảo để trải nghiệm thử bản đồ trong khu vực trung tâm TP.HCM.
export const PLACES: Place[] = [
  {
    id: 'central-post-office', title: 'Bưu điện Trung tâm Sài Gòn',
    subtitle: {vi:'Dấu ấn kiến trúc giữa lòng thành phố',en:'A historic architectural landmark',fr:'Un joyau architectural historique',ja:'街の中心にある歴史的建築'},
    description: {
      vi:'Bưu điện Trung tâm Sài Gòn là một trong những công trình nổi bật ở trung tâm Thành phố Hồ Chí Minh. Tòa nhà gây ấn tượng với mái vòm cao, chi tiết trang trí cổ điển và không gian giao thoa giữa quá khứ với cuộc sống hiện đại. Đây là điểm dừng chân thú vị để khám phá lịch sử đô thị.',
      en:'Saigon Central Post Office is one of Ho Chi Minh City’s most recognizable landmarks. Its grand hall, arched ceiling, and historic details offer a window into the city’s architectural heritage.',
      fr:'La Poste centrale de Saïgon est l’un des monuments emblématiques de Hô Chi Minh-Ville. Sa grande salle et ses détails historiques évoquent le patrimoine architectural de la ville.',
      ja:'サイゴン中央郵便局はホーチミン市を代表する歴史的建造物です。大きなアーチ天井と美しい装飾から街の建築文化を感じられます。'
    },
    category:'Kiến trúc', district:'Quận 1', latitude:10.7797, longitude:106.6999,
    image:'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=1200&q=85', duration:4, rating:4.8,
  },
  {
    id:'independence-palace', title:'Dinh Độc Lập',
    subtitle:{vi:'Chứng nhân của những dấu mốc lịch sử',en:'A landmark of modern Vietnamese history',fr:'Un lieu clé de l’histoire vietnamienne',ja:'ベトナム現代史を物語る場所'},
    description:{
      vi:'Dinh Độc Lập, còn được gọi là Hội trường Thống Nhất, gắn liền với nhiều thời khắc quan trọng của lịch sử Việt Nam. Công trình có khuôn viên xanh mát, kiến trúc đặc trưng và các không gian trưng bày giúp du khách tìm hiểu thêm về quá khứ.',
      en:'Independence Palace, also known as Reunification Palace, is an important site in Vietnamese history. Visitors can explore its architecture, landscaped grounds, and rooms associated with significant historical events.',
      fr:'Le Palais de l’Indépendance est un lieu important de l’histoire du Vietnam. Son architecture, ses jardins et ses salles historiques invitent à la découverte.',
      ja:'統一会堂はベトナムの歴史において重要な場所です。特徴的な建築や庭園、歴史的な展示を見学できます。'
    },
    category:'Lịch sử', district:'Quận 1', latitude:10.7770, longitude:106.6953,
    image:'https://images.unsplash.com/photo-1557750255-c76072a7aad1?w=1200&q=85', duration:5, rating:4.9,
  },
  {
    id:'ben-thanh-market', title:'Chợ Bến Thành',
    subtitle:{vi:'Nhịp sống và sắc màu Sài Gòn',en:'The colors and energy of Saigon',fr:'Les couleurs et l’énergie de Saïgon',ja:'サイゴンの活気と彩り'},
    description:{
      vi:'Chợ Bến Thành là một biểu tượng văn hóa của Thành phố Hồ Chí Minh. Nơi đây quy tụ nhiều gian hàng ẩm thực, quà lưu niệm, vải vóc và sản phẩm địa phương. Tham quan chợ là cách gần gũi để cảm nhận nhịp sống đô thị.',
      en:'Ben Thanh Market is a lively symbol of Ho Chi Minh City. Its many stalls offer local food, souvenirs, textiles, and a glimpse of everyday city life.',
      fr:'Le marché Bến Thành est un symbole animé de Hô Chi Minh-Ville. On y découvre la cuisine locale, des souvenirs et la vie quotidienne.',
      ja:'ベンタイン市場はホーチミン市の活気あるシンボルです。地元の料理やお土産、日常のにぎわいに触れられます。'
    },
    category:'Văn hóa', district:'Quận 1', latitude:10.7722, longitude:106.6980,
    image:'https://images.unsplash.com/photo-1569429593410-b498b3fb3387?w=1200&q=85', duration:4, rating:4.7,
  },
  {
    id:'notre-dame', title:'Nhà thờ Đức Bà Sài Gòn',
    subtitle:{vi:'Nét cổ kính giữa phố thị',en:'A classic city-center icon',fr:'Une icône classique du centre-ville',ja:'街の中心に残る歴史的な景観'},
    description:{
      vi:'Nhà thờ Đức Bà Sài Gòn nổi bật bởi kiến trúc gạch đỏ và vị trí ngay trung tâm thành phố. Công trình có giá trị kiến trúc và là điểm đến quen thuộc trong hành trình tìm hiểu di sản đô thị. Tình trạng tham quan có thể thay đổi do công tác trùng tu.',
      en:'Notre-Dame Cathedral Basilica of Saigon is known for its red-brick exterior and central location. Visitor access may vary while restoration works take place.',
      fr:'La cathédrale Notre-Dame de Saïgon est réputée pour sa façade de briques rouges. Les conditions de visite peuvent varier pendant les travaux de restauration.',
      ja:'サイゴン大聖堂は赤レンガの外観で知られています。修復工事により見学できる範囲が変わる場合があります。'
    },
    category:'Kiến trúc', district:'Quận 1', latitude:10.7798, longitude:106.6990,
    image:'https://images.unsplash.com/photo-1528127269322-539801943592?w=1200&q=85', duration:3, rating:4.8,
  },
  {
    id:'fine-arts-museum', title:'Bảo tàng Mỹ thuật TP.HCM',
    subtitle:{vi:'Không gian sáng tạo và di sản',en:'Art, creativity and heritage',fr:'Art, créativité et patrimoine',ja:'芸術と歴史に出会う場所'},
    description:{
      vi:'Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh lưu giữ và trưng bày nhiều tác phẩm mỹ thuật. Bên cạnh những bộ sưu tập, bản thân tòa nhà cũng thu hút bởi lối kiến trúc và không gian giàu tính thẩm mỹ.',
      en:'The Ho Chi Minh City Museum of Fine Arts displays a variety of artworks. Its historic building is also admired for its distinctive architecture.',
      fr:'Le musée des Beaux-Arts de Hô Chi Minh-Ville présente de nombreuses œuvres dans un bâtiment historique à l’architecture remarquable.',
      ja:'ホーチミン市美術館にはさまざまな美術作品が展示され、建物そのものも魅力的な歴史的建築です。'
    },
    category:'Văn hóa', district:'Quận 1', latitude:10.7698, longitude:106.6992,
    image:'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=1200&q=85', duration:5, rating:4.6,
  },
  {
    id:'bitexco', title:'Tháp Bitexco',
    subtitle:{vi:'Một góc nhìn mới về đô thị',en:'A modern perspective on the skyline',fr:'Un nouveau regard sur la ville',ja:'現代都市のスカイライン'},
    description:{
      vi:'Tháp Tài chính Bitexco là một công trình hiện đại nổi bật trên đường chân trời trung tâm Thành phố Hồ Chí Minh. Thiết kế của tòa nhà tạo dấu ấn riêng và gợi nhắc sự chuyển mình của thành phố.',
      en:'Bitexco Financial Tower is a recognizable modern landmark in Ho Chi Minh City’s skyline. Its distinctive design reflects the city’s growth and transformation.',
      fr:'La tour financière Bitexco est un repère moderne de l’horizon de Hô Chi Minh-Ville et symbolise son développement.',
      ja:'ビテクスコ・フィナンシャルタワーはホーチミン市の近代的なランドマークです。独特の形が街の発展を象徴しています。'
    },
    category:'Khám phá', district:'Quận 1', latitude:10.7717, longitude:106.7040,
    image:'https://images.unsplash.com/photo-1509030450996-dd1a26dda07a?w=1200&q=85', duration:3, rating:4.6,
  },
];

export const findPlace = (id: string) => PLACES.find(p => p.id === id);
