-- ============================================================
-- Crema — reference data seed (Roadmap step 1.4)
--
-- GENERATED from src/data/seed.js and src/data/catalog.js.
-- Run after schema.sql. Re-runnable: upserts on the primary key.
--
-- These tables stay bundled in the repo as the offline/fallback
-- dataset (guiding principle 4) — this makes the DB authoritative
-- without making it required.
-- ============================================================

-- ---------- cafés ----------
-- lat/lng are APPROXIMATE, derived from the street/area names. Verify
-- against real addresses before the native map (step 2.3) uses them.
insert into cafes (id,name,area,city,spec,rating,followers,promo,img,color,blurb,hours,lat,lng,menu,sort) values
  ('suedhang','Südhang','Österbergstraße · Österberg','Tübingen','Hillside café & roastery',4.7,1120,true,'assets/l4.jpg','#8a5a30','A sunlit café on the Österberg with a panoramic terrace over the old town — house-roasted single origins and meticulous espresso.','Open · closes 18:00',48.5231,9.0625,'{"beans":["Bumblebee Espresso","Espresso Anniversario"],"roaster":"The Barn","machine":"La Marzocco Linea Mini","milks":["Whole milk","Barista oat","Almond"]}'::jsonb,0),
  ('willis','Willi''s','Am Lustnauer Tor · Altstadt','Tübingen','Café & bar',4.5,860,false,'assets/l7.jpg','#527a86','Easy-going café-bar by the Lustnauer Tor — sharp espresso and cake through the day, natural wine after dark.','Open · closes 23:00',48.5228,9.0588,'{"beans":["Espresso Blend"],"roaster":"Five Elephant","machine":"Sage Barista Pro","milks":["Whole milk","Oat","Almond"]}'::jsonb,1),
  ('marktschenke','Marktschenke','Marktplatz · Altstadt','Tübingen','Old-town coffee house',4.4,700,false,'assets/l5.jpg','#a8544a','Right on the Marktplatz under the Rathaus — classic coffee-house mornings, house cakes and a terrace on the square.','Open · closes 18:30',48.5216,9.0553,'{"beans":["Crema d''Oro Intensa","Prodomo"],"roaster":"Dallmayr","machine":"Sage Dual Boiler","milks":["Whole milk","Semi-skimmed","Oat"]}'::jsonb,2),
  ('hanseatica','Hanseatica','Neckargasse · Altstadt','Tübingen','Kaffeehaus & pâtisserie',4.6,780,true,'assets/l6.jpg','#6f7a4e','A refined Kaffeehaus off the Neckargasse — pâtisserie counter, filter flights and unhurried afternoons.','Open · closes 19:00',48.5205,9.0548,'{"beans":["Bel Canto Espresso"],"roaster":"Supremo","machine":"Rocket Appartamento","milks":["Whole milk","Oat","Soy"]}'::jsonb,3),
  ('waschhaus','Waschhaus','Gartenstraße · am Neckar','Tübingen','Café in a former washhouse',4.3,640,false,'assets/l1.jpg','#b58a3a','A characterful café in a converted washhouse by the Neckar — big communal tables, students and a steady flow of flat whites.','Open · closes 17:00',48.519,9.051,'{"beans":["Dark Horse Espresso"],"roaster":"Bonanza","machine":"Profitec Pro 500","milks":["Whole milk","Oat","Soy"]}'::jsonb,4)
on conflict (id) do update set
  name=excluded.name, area=excluded.area, city=excluded.city, spec=excluded.spec,
  rating=excluded.rating, followers=excluded.followers, promo=excluded.promo,
  img=excluded.img, color=excluded.color, blurb=excluded.blurb, hours=excluded.hours,
  lat=excluded.lat, lng=excluded.lng, menu=excluded.menu, sort=excluded.sort;

-- ---------- beans ----------
insert into beans (name,roaster,country,loc,origin,roast,notes) values
  ('Bumblebee Espresso','The Barn','Germany','DE','Colombia · Ethiopia blend','Medium',ARRAY['Milk chocolate','Red berry','Caramel']),
  ('Espresso Anniversario','The Barn','Germany','DE','Seasonal blend','Medium',ARRAY['Cocoa','Orange','Brown sugar']),
  ('Dark Horse Espresso','Bonanza','Germany','DE','Seasonal blend','Medium-dark',ARRAY['Dark chocolate','Hazelnut','Cherry']),
  ('Espresso Blend','Five Elephant','Germany','DE','Brazil · Ethiopia','Medium',ARRAY['Chocolate','Almond','Orange']),
  ('Buna Dimaa','Coffee Circle','Germany','DE','Ethiopia · Sidama','Light-medium',ARRAY['Jasmine','Blueberry','Honey']),
  ('Bright Eyes Espresso','19grams','Germany','DE','Seasonal blend','Medium',ARRAY['Caramel','Stone fruit','Cocoa']),
  ('Espresso No.1','Elbgold','Germany','DE','Brazil · Guatemala','Medium',ARRAY['Chocolate','Nut','Brown sugar']),
  ('Fair Play Espresso','Quijote Kaffee','Germany','DE','Direct-trade blend','Medium',ARRAY['Cocoa','Nougat','Citrus']),
  ('Hafencity Espresso','Speicherstadt','Germany','DE','Blend','Medium-dark',ARRAY['Dark chocolate','Toffee','Low acidity']),
  ('Bel Canto Espresso','Supremo','Germany','DE','Blend','Medium',ARRAY['Chocolate','Marzipan','Cherry']),
  ('Espresso Crema Classico','Dinzler','Germany','DE','Blend','Medium',ARRAY['Nut','Caramel','Mild']),
  ('MVSM Espresso','Man Versus Machine','Germany','DE','Seasonal blend','Medium',ARRAY['Berry','Chocolate','Caramel']),
  ('Rocket Man Espresso','JB Kaffee','Germany','DE','Blend','Medium',ARRAY['Cocoa','Red apple','Nut']),
  ('Prodomo','Dallmayr','Germany','DE','Blend','Medium',ARRAY['Mild','Balanced','Low acidity']),
  ('Crema d''Oro Intensa','Dallmayr','Germany','DE','Blend','Medium-dark',ARRAY['Creamy','Chocolate','Nut']),
  ('BellaCrema LaCrema','Melitta','Germany','DE','Blend','Medium',ARRAY['Smooth','Nutty','Chocolate']),
  ('Meisterwerk Espresso','Meisterwerk Kaffee','Germany','DE','Tübingen roast · blend','Medium',ARRAY['Chocolate','Hazelnut','Caramel']),
  ('Meisterwerk Hausmischung','Meisterwerk Kaffee','Germany','DE','Blend','Medium-dark',ARRAY['Cocoa','Nut','Dark sugar']),
  ('Herr Lutz Espresso','Herr Lutz','Germany','DE','Stuttgart roast · blend','Medium',ARRAY['Caramel','Berry','Chocolate']),
  ('Mókuska Espresso','Mókuska Caffè','Germany','DE','Stuttgart roast · blend','Medium',ARRAY['Chocolate','Almond','Citrus']),
  ('Qualità Rossa','Lavazza','Italy','INT','Blend','Medium',ARRAY['Chocolate','Dried fruit']),
  ('Qualità Oro','Lavazza','Italy','INT','Blend','Medium',ARRAY['Caramel','Honey','Floral']),
  ('Super Crema','Lavazza','Italy','INT','Blend','Medium',ARRAY['Hazelnut','Brown sugar','Mild']),
  ('Classico','Illy','Italy','INT','Blend','Medium',ARRAY['Caramel','Chocolate','Floral']),
  ('Intenso','Illy','Italy','INT','Blend','Dark',ARRAY['Cocoa','Dried fruit','Bold']),
  ('Intermezzo','Segafredo','Italy','INT','Blend','Medium-dark',ARRAY['Cocoa','Woody','Spice']),
  ('Red Brick Espresso','Square Mile','United Kingdom','INT','Seasonal blend','Medium',ARRAY['Red fruit','Caramel','Chocolate']),
  ('Espresso','Tim Wendelboe','Norway','INT','Seasonal','Light',ARRAY['Berry','Floral','Bright']),
  ('House Espresso','The Coffee Collective','Denmark','INT','Seasonal','Light-medium',ARRAY['Stone fruit','Caramel','Clean']),
  ('Espresso Roast','Starbucks','USA','INT','Blend','Dark',ARRAY['Caramelized','Rich','Bold'])
on conflict (name) do update set
  roaster=excluded.roaster, country=excluded.country, loc=excluded.loc,
  origin=excluded.origin, roast=excluded.roast, notes=excluded.notes;

-- ---------- challenges ----------
insert into challenges (id,title,tag,pattern,ends,participants,blurb,sort) values
  ('tue','Tulip Tuesday','#TulipTuesday','tulip','2d',1240,'Stack your best tulip this week. Clean separation between layers wins.',0),
  ('rush','Rosetta Rush','#RosettaRush','rosetta','3d',862,'Seven days, one goal: the sharpest rosetta of your life.',1),
  ('hearts','Beginner Hearts','#FirstHeart','heart','5d',2103,'New to latte art? Post your best heart — wobble welcome.',2),
  ('swan','Swan Sundays','#SwanSundays','swan','6d',317,'The hardest pour there is. Show us your neck game.',3)
on conflict (id) do update set
  title=excluded.title, tag=excluded.tag, pattern=excluded.pattern, ends=excluded.ends,
  participants=excluded.participants, blurb=excluded.blurb, sort=excluded.sort;
