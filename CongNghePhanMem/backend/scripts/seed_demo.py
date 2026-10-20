"""Insert a small, repeatable Vietnamese demo guide into the configured database.

Run from the backend directory after configuring backend/.env:
    python scripts/seed_demo.py
"""
from app.database import Base, SessionLocal, engine
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models import audio_session, favorite, history, review, user  # noqa: F401


DESTINATIONS = [
    {
        "name": "Kinh thành Huế",
        "category": "Di sản · Huế",
        "address": "Thành phố Huế, Việt Nam",
        "latitude": 16.4637,
        "longitude": 107.5909,
        "description": "Không gian di sản gắn với triều Nguyễn, những lớp thành cổ và nhịp sống bên dòng sông Hương.",
        "guides": {
            "vi": ("Một vòng Kinh thành Huế", "Hãy bắt đầu từ những cánh cổng thành và dành thời gian quan sát các lớp không gian nối tiếp nhau. Kinh thành là nơi lịch sử triều Nguyễn hiện diện trong kiến trúc, nghi lễ và đời sống của cố đô. Đi chậm dưới những tán cây, bạn sẽ nghe thấy nhịp sống hôm nay hòa cùng vẻ trầm mặc của thành cũ. Khi rời Đại Nội, hãy nhìn về phía sông Hương và tưởng tượng con thuyền từng đưa bao câu chuyện qua miền đất này."),
            "en": ("A walk through Hue Citadel", "Begin at the old gates and take time to notice how each space opens into another. The Citadel carries the history of the Nguyen dynasty through its architecture, ceremonies, and the everyday life of the former capital. Walk slowly beneath the trees and let the present day meet the quiet character of the old city. As you leave the Imperial Enclosure, look toward the Perfume River and imagine the stories that have travelled along its banks."),
            "zh": ("漫步顺化皇城", "从古老的城门开始，慢慢观察层层展开的空间。皇城通过建筑、仪式和日常生活，留下阮朝与古都的历史痕迹。走在树荫下，让今天的城市生活与古城的宁静彼此交汇。离开大内时，不妨望向香江，想象那些沿着河岸流传至今的故事。"),
        },
    },
    {
        "name": "Phố cổ Hội An",
        "category": "Phố cổ · Quảng Nam",
        "address": "Thành phố Hội An, Việt Nam",
        "latitude": 15.8801,
        "longitude": 108.3380,
        "description": "Những con phố nhỏ, mái nhà cổ và dấu ấn giao thương tạo nên vẻ duyên dáng riêng của Hội An.",
        "guides": {
            "vi": ("Hội An, phố nhỏ chuyện dài", "Hội An đẹp nhất khi bạn không vội. Hãy rẽ vào một con hẻm nhỏ, ngắm những khung cửa gỗ và màu tường đã được nắng mưa làm dịu lại. Nơi đây từng đón những người buôn bán và lữ khách từ nhiều vùng đất, để lại một phố cảng mang nhiều lớp văn hóa. Khi chiều xuống, ánh đèn lồng phản chiếu trên mặt phố, biến một cuộc dạo chơi bình thường thành ký ức khó quên."),
            "en": ("Hoi An, a small town with long stories", "Hoi An is best experienced without a hurry. Turn into a quiet lane, notice the wooden shutters, and see how time has softened the old walls. Traders and travellers once arrived from many places, leaving the town with layers of cultural influence. At dusk, lantern light settles over the streets and turns an ordinary walk into a lasting memory."),
            "zh": ("会安古镇的漫长故事", "不必匆忙，慢慢感受会安。走进一条安静的小巷，看看木窗和被岁月柔化的墙面。这里曾迎来来自不同地方的商人与旅人，也因此留下多元的文化印记。黄昏时分，灯笼的光映在街道上，一次普通的散步也会成为难忘的回忆。"),
        },
    },
    {
        "name": "Vịnh Hạ Long",
        "category": "Thiên nhiên · Quảng Ninh",
        "address": "Thành phố Hạ Long, Việt Nam",
        "latitude": 20.9101,
        "longitude": 107.1839,
        "description": "Mặt nước xanh và những đảo đá tạo nên một miền cảnh quan rộng mở ở phía đông bắc Việt Nam.",
        "guides": {
            "vi": ("Lắng nghe vịnh Hạ Long", "Từ bờ vịnh, hãy để mắt mình đi theo những dãy đảo đá nhô lên giữa mặt nước. Mỗi góc nhìn mở ra một khoảng trời khác, khi gần gũi, khi rộng lớn đến bất ngờ. Gió mang theo vị mặn và tiếng sóng nhắc ta chậm lại để cảm nhận cảnh sắc. Nếu có dịp đi thuyền, hãy dành một lúc yên lặng giữa hành trình, chỉ để ngắm mặt nước đổi màu theo ánh sáng."),
            "en": ("Listening to Ha Long Bay", "From the shore, let your eyes follow the limestone islands rising from the water. Every turn reveals a different view, sometimes intimate and sometimes unexpectedly vast. The breeze carries the sea's salt and the sound of waves invites you to slow down. If you take a boat trip, pause for a quiet moment and watch the water change colour with the light."),
            "zh": ("聆听下龙湾", "站在海湾边，让目光追随水面上起伏的石岛。每一个转弯都会带来不同的景色，有时亲切，有时辽阔得令人惊叹。海风带来咸咸的气息，海浪声也提醒我们放慢脚步。如果乘船游览，不妨在途中安静片刻，看阳光如何改变海水的颜色。"),
        },
    },
]


def seed() -> tuple[int, int]:
    Base.metadata.create_all(bind=engine)
    places_created = 0
    guides_created = 0
    with SessionLocal() as db:
        for item in DESTINATIONS:
            place = db.query(Place).filter(Place.name == item["name"]).one_or_none()
            if place is None:
                place = Place(**{key: value for key, value in item.items() if key != "guides"})
                db.add(place)
                db.flush()
                places_created += 1
            for language, (title, content) in item["guides"].items():
                exists = (
                    db.query(GuideContent.id)
                    .filter(GuideContent.place_id == place.id, GuideContent.language_code == language)
                    .first()
                )
                if not exists:
                    db.add(GuideContent(
                        place_id=place.id,
                        language_code=language,
                        title=title,
                        content=content,
                    ))
                    guides_created += 1
        db.commit()
    return places_created, guides_created


if __name__ == "__main__":
    places, guides = seed()
    print(f"Demo seed complete: {places} places and {guides} guide translations added.")
