-- ============================================================
-- Crema — reference data seed (Roadmap step 1.4)
--
-- GENERATED from src/data/seed.js and src/data/catalog.js.
-- Run after schema.sql. Re-runnable: upserts on the primary key.
--
-- These tables are the app's only source for cafés, beans and
-- challenges: src/data/world.js ships empty arrays and fills them from
-- here. Follower and participant counts are NOT stored — they are
-- counted from cafe_follows / challenge_joins at read time, so nothing
-- in the app can show a number nobody earned.
-- ============================================================

-- ---------- cafés ----------
-- Deliberately empty. The five Tübingen cafés that used to be seeded here
-- were removed in step-1.10.sql: real names, but hours, ratings and menus
-- nobody had verified. Add cafés through the dashboard when there is real
-- data behind them; the app reads whatever this table holds, including
-- nothing.

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
  ('Espresso Roast','Starbucks','USA','INT','Blend','Dark',ARRAY['Caramelized','Rich','Bold']),
  -- 2026-08-07 — more German specialty, and more of the world (src/data/catalog.js)
  ('Berlin Kreuzberg','Bonanza Coffee Roasters','Germany','DE','Seasonal single origin','Light',ARRAY['Bright','Fruity','Clean']),
  ('Filter No.1','Five Elephant','Germany','DE','Seasonal single origin','Light-medium',ARRAY['Sweet','Balanced','Fruity']),
  ('Hamburg Blend','19grams','Germany','DE','Blend','Medium',ARRAY['Chocolate','Nutty','Balanced']),
  ('Original Roast','Douwe Egberts','Netherlands','INT','Blend','Medium',ARRAY['Smooth','Balanced','Classic']),
  ('Aroma Rood','Douwe Egberts','Netherlands','INT','Blend','Medium',ARRAY['Mild','Nutty','Light']),
  ('Mocca Cream','Löfbergs','Sweden','INT','Blend','Medium',ARRAY['Sweet','Mild','Smooth']),
  ('Mörkrost','Gevalia','Sweden','INT','Blend','Dark',ARRAY['Bold','Roasted','Rich']),
  ('Presidentti','Paulig','Finland','INT','Blend','Light-medium',ARRAY['Light','Clean','Mild']),
  ('Juhla Mokka','Paulig','Finland','INT','Blend','Medium',ARRAY['Balanced','Nutty','Mild']),
  ('Delta Blend','Delta Cafés','Portugal','INT','Blend','Medium-dark',ARRAY['Bold','Chocolate','Rich']),
  ('Café Rombouts','Rombouts','Belgium','INT','Blend','Medium',ARRAY['Balanced','Nutty','Mild']),
  ('Café Especial','Nomad Coffee','Spain','INT','Single origin, seasonal','Light',ARRAY['Bright','Fruity','Floral']),
  ('Kaffeemacher Espresso','Kaffeemacher','Switzerland','INT','Blend','Medium',ARRAY['Balanced','Cocoa','Smooth']),
  ('Juan Valdez Selección','Juan Valdez','Colombia','INT','Colombia','Medium',ARRAY['Caramel','Citrus','Balanced']),
  ('Café Britt Tarrazú','Café Britt','Costa Rica','INT','Costa Rica · Tarrazú','Medium',ARRAY['Bright','Citrus','Chocolate']),
  ('Trung Nguyên Espresso Roast','Trung Nguyên','Vietnam','INT','Vietnam · Robusta blend','Dark',ARRAY['Bold','Earthy','Low acidity']),
  ('Kurukahveci Mehmet Efendi','Kurukahveci Mehmet Efendi','Turkey','INT','Blend, fine-ground','Medium-dark',ARRAY['Rich','Spiced','Traditional']),
  ('Blue Tokai South Indian','Blue Tokai','India','INT','India · Chikmagalur','Medium',ARRAY['Spicy','Malty','Full-bodied']),
  ('Kicking Horse Kick Ass','Kicking Horse','Canada','INT','Blend','Dark',ARRAY['Bold','Smoky','Intense']),
  ('Vittoria Espresso','Vittoria Coffee','Australia','INT','Blend','Medium-dark',ARRAY['Chocolate','Nutty','Balanced']),
  ('Market Lane Filter Blend','Market Lane','Australia','INT','Seasonal single origin','Light',ARRAY['Berry','Floral','Bright']),
  ('Onibus Blend','Onibus Coffee','Japan','INT','Seasonal single origin','Light-medium',ARRAY['Delicate','Clean','Floral']),
  ('Major Dickason''s Blend','Peet''s Coffee','USA','INT','Blend','Dark',ARRAY['Bold','Rich','Full-bodied']),
  ('Hair Bender','Stumptown','USA','INT','Latin America · East Africa blend','Medium',ARRAY['Chocolate','Citrus','Complex']),
  ('Monarch','Onyx Coffee Lab','USA','INT','Blend','Medium',ARRAY['Sweet','Balanced','Cocoa']),
  ('Revelation Espresso','Union Hand-Roasted Coffee','United Kingdom','INT','Blend','Medium',ARRAY['Sweet','Balanced','Red fruit']),
  ('Monmouth Espresso','Monmouth Coffee','United Kingdom','INT','Blend','Medium',ARRAY['Nutty','Sweet','Smooth']),
  ('Ethiopia Filter','Drop Coffee','Sweden','INT','Ethiopia','Light',ARRAY['Jasmine','Citrus','Tea-like']),
  ('Filter Blend','The Coffee Collective','Denmark','INT','Seasonal single origin','Light',ARRAY['Bright','Fruity','Floral']),
  ('Oslo Filter','Fuglen','Norway','INT','Blend','Light',ARRAY['Crisp','Fruity','Clean'])
on conflict (name) do update set
  roaster=excluded.roaster, country=excluded.country, loc=excluded.loc,
  origin=excluded.origin, roast=excluded.roast, notes=excluded.notes;

-- ---------- challenges ----------
insert into challenges (id,title,tag,pattern,ends,participants,blurb,sort) values
  ('tue','Tulip Tuesday','#TulipTuesday','tulip','2d',0,'Stack your best tulip this week. Clean separation between layers wins.',0),
  ('rush','Rosetta Rush','#RosettaRush','rosetta','3d',0,'Seven days, one goal: the sharpest rosetta of your life.',1),
  ('hearts','Beginner Hearts','#FirstHeart','heart','5d',0,'New to latte art? Post your best heart — wobble welcome.',2),
  ('swan','Swan Sundays','#SwanSundays','swan','6d',0,'The hardest pour there is. Show us your neck game.',3)
on conflict (id) do update set
  title=excluded.title, tag=excluded.tag, pattern=excluded.pattern, ends=excluded.ends,
  participants=excluded.participants, blurb=excluded.blurb, sort=excluded.sort;
