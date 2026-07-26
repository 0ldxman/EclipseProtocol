import json
import random
from database import engine, Base, SessionLocal
from models import Side, Country, Province

Base.metadata.create_all(engine)
db = SessionLocal()

# sides
db.merge(Side(tag="APO", label="Протокол Аполлон", color="#0053be"))
db.merge(Side(tag="EDN", label="Новый Эдем",        color="#ff2929"))
db.commit()
print("Sides: OK")

# countries из shapeGroup
GEO = "data/geo/ECL_Provinces.geojson"
with open(GEO, encoding="utf-8") as f:
    data = json.load(f)

tags = sorted({feat["properties"]["shapeGroup"] for feat in data["features"] if feat["properties"].get("shapeGroup")})
print(f"Unique countries: {len(tags)}")

def rand_color():
    h = random.randint(0, 359)
    s = random.randint(45, 75)
    l = random.randint(35, 55)
    # HSL → hex
    s /= 100; l /= 100
    c = (1 - abs(2*l - 1)) * s
    x = c * (1 - abs((h/60) % 2 - 1))
    m = l - c/2
    if   h < 60:  r,g,b = c,x,0
    elif h < 120: r,g,b = x,c,0
    elif h < 180: r,g,b = 0,c,x
    elif h < 240: r,g,b = 0,x,c
    elif h < 300: r,g,b = x,0,c
    else:         r,g,b = c,0,x
    r,g,b = int((r+m)*255), int((g+m)*255), int((b+m)*255)
    return f"#{r:02x}{g:02x}{b:02x}"

for tag in tags:
    db.merge(Country(tag=tag, name=tag, color=rand_color()))
db.commit()
print("Countries: OK")

# provinces
for feat in data["features"]:
    p = feat["properties"]
    fid = p.get("fid")
    owner = p.get("shapeGroup")
    if fid is None or not owner:
        continue
    db.merge(Province(fid=fid, owner=owner, occupied_by=None))
db.commit()
print(f"Provinces: OK ({len(data['features'])} features)")

db.close()
