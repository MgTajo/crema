"use strict";
/* ============================================================
   data/catalog — static reference data ("the menu").
   Drinks, milks, machines, levels, purchasable beans and the country
   flags. In the target app a backend serves this read-only catalog;
   here it is bundled. No app state lives here.
   ============================================================ */

/* ---------- drinks ---------- */
export const DRINKS=['Cappuccino','Latte','Flat white','Cortado','Piccolo','Mocha','Macchiato',
  'Espresso','Doppio','Americano','Long black','Pour-over','Filter','Cold brew','Aeropress','Iced latte'];
export const MILK_DRINKS=new Set(['Cappuccino','Latte','Flat white','Cortado','Piccolo','Mocha','Macchiato']);
export const DRINK_ART=Object.fromEntries(DRINKS.map(d=>[d,MILK_DRINKS.has(d)]));
export const HAS_MILK=new Set([...MILK_DRINKS,'Iced latte']);   // drinks where milk type matters
export const MILK_LIST=['Whole milk','Semi-skimmed','Skimmed','Lactose-free','Oat','Barista oat','Almond','Soy','Coconut'];

/* The free tier's whole drink list — the everyday six. Everything else
   in DRINKS still exists (posts made with them keep showing correctly),
   but only Premium accounts can pick one for a new pour. */
export const FREE_DRINKS=['Cappuccino','Espresso','Americano','Flat white','Cortado','Filter'];

/* Sentinel for a Premium user's own drink type — same trick as
   ADD_BEAN/MY_BEANS below: picking it swaps the dropdown for a text
   field, and the name they type is remembered (state.customDrinks) so
   it rejoins the dropdown as a normal choice next time, for them only. */
export const ADD_DRINK='＋ Add your own drink…';

/* ---------- machines: brand → model (pick brand first, then model) ---------- */
export const MACHINES={
  'La Marzocco':['Linea Mini','Linea Micra','GS3 AV','GS3 MP','Linea PB'],
  'Rocket Espresso':['Appartamento','Appartamento TCA','Mozzafiato Cronometro R','Giotto Cronometro R','R58 Cinquantotto','R Nine One','Bicocca'],
  'ECM':['Synchronika','Technika V Profi PID','Mechanika V Slim','Classika PID','Puristika'],
  'Profitec':['GO','Pro 300','Pro 400','Pro 500 PID','Pro 600','Pro 700','Pro 800'],
  'Lelit':['Anna','Grace','Victoria','Mara X','Bianca','Elizabeth'],
  'Rancilio':['Silvia','Silvia M','Silvia Pro X'],
  'Gaggia':['Classic Evo Pro','Classic Pro','Cadorna Prestige','Anima','Magenta Plus'],
  'Sage':['Bambino','Bambino Plus','Barista Express','Barista Express Impress','Barista Pro','Barista Touch','Barista Touch Impress','Dual Boiler','Oracle','Oracle Touch','Oracle Jet'],
  'Breville':['Bambino Plus','Barista Express','Barista Pro','Dual Boiler','Oracle Touch'],
  'Ascaso':['Dream PID','Baby T Plus','Steel Duo PID','Big Dream'],
  'Quick Mill':['Rubino','Silvano Evo','Vetrano 2B','QM67'],
  'Bezzera':['Hobby','BZ10','Duo DE','Magica','Unica'],
  'Nuova Simonelli':['Oscar II','Musica'],
  'Victoria Arduino':['Eagle One Prima','Pigna'],
  'DeLonghi':['Dedica','La Specialista Arte','La Specialista Maestro','La Specialista Opera','Magnifica S','Magnifica Evo','Eletta Explore','Dinamica Plus','PrimaDonna Soul','Rivelia'],
  'Jura':['ENA 8','E6','E8','S8','Z10','GIGA 6'],
  'Philips':['Series 2200 LatteGo','Series 3200 LatteGo','Series 4300 LatteGo','Series 5400 LatteGo','Series 5500 LatteGo'],
  'Siemens':['EQ.6 plus','EQ.500','EQ.700','EQ.9 plus'],
  'Melitta':['Solo','Caffeo Barista TS','CI Touch','Latticia One Touch'],
  'Saeco':['PicoBaristo Deluxe','Xelsis','GranAroma'],
  'Nivona':['CafeRomatica 7 series','CafeRomatica 8 series'],
  'Miele':['CM 5510','CM 6360','CM 7750'],
  'Flair':['NEO Flex','Classic','58','58x','Pro 2'],
  'La Pavoni':['Europiccola','Professional'],
  'Cafelat':['Robot'],
  'Wacaco':['Minipresso','Nanopresso','Picopresso'],
  'Hario':['V60','V60 Switch','Mugen','Woodneck'],
  'Chemex':['Classic','Ottomatic'],
  'AeroPress':['Original','Go','Clear','XL'],
  'Fellow':['Stagg [X]','Stagg [XF]'],
  'Kalita':['Wave 155','Wave 185'],
  'Origami':['Dripper S','Dripper M'],
  'Moccamaster':['KBGV Select','KBG','Cup-One'],
  'Bialetti':['Moka Express','Brikka','Venus','Moka Induction','New Venus Induction','Kitty'],
  'Grosche':['Milano Moka Pot','Genova Moka Pot','Zurich French Press'],
  'Cilio':['Classico Espresso Maker','Roma Espresso Maker'],
  'Bugatti':['Diva Moka Pot'],
  'Bodum':['Chambord French Press','Pour Over','Brazil French Press'],
  'Espro':['P3 Press','Bloom Pour Over'],
  'Timemore':['French Press','U Pour Over'],
  'Krups':['Evidence','Essential','Intuition Preference'],
  'Bosch':['VeroCafe','VeroCup','VeroAroma'],
  'WMF':['Perfection 890L','Kitchenminis Aroma'],
  'Gastroback':['Design Espresso Advanced','Design Espresso Barista Pro'],
  'Other':[]
};
export const MACHINE_BRANDS=Object.keys(MACHINES);
export function combineMachine(brand,model){ if(!brand) return ''; if(brand==='Other') return (model||'').trim(); return model?brand+' '+model:''; }
/* The inverse, for re-logging someone's recipe: a stored "Sage Bambino
   Plus" has to become brand + model again, or the machine picker silently
   drops it. Longest brand first, so 'Rocket Espresso' beats 'Rocket'. */
export function splitMachine(combined){
  const s=(combined||'').trim();
  if(!s) return { brand:'', model:'' };
  const brand=MACHINE_BRANDS.filter(b=>b!=='Other')
    .sort((a,b)=>b.length-a.length)
    .find(b=>s===b || s.toLowerCase().startsWith(b.toLowerCase()+' '));
  if(!brand) return { brand:'Other', model:s };
  return { brand, model:s.slice(brand.length).trim() };
}

export const ADD_BEAN='＋ Add your own coffee…';
/* [level, name, points needed to reach it]. Each step costs roughly 1.5x
   the one before, so Level 2 is ten pours away and Level 10 is a real
   milestone. This table mirrors level_for_points() in
   supabase/step-1.9.sql — the database is the authority, this copy draws
   the progress bar. Keep them in step. */
export const LEVELS=[[1,'First Sips',0],[2,'Steam Dreams',100],[3,'Heart Starter',250],[4,'Heart Artist',500],
  [5,'Tulip Tinkerer',900],[6,'Rosetta Artist',1500],[7,'Rosetta Pro',2400],[8,'Swan Apprentice',3800],
  [9,'Swan Master',6000],[10,'Latte Legend',9500]];

/* ---------- origin flags ---------- */
export const flag={Ethiopia:'🇪🇹',Colombia:'🇨🇴',Brazil:'🇧🇷',Kenya:'🇰🇪',Guatemala:'🇬🇹',Indonesia:'🇮🇩',Peru:'🇵🇪',Rwanda:'🇷🇼','Costa Rica':'🇨🇷',Germany:'🇩🇪',Italy:'🇮🇹','United Kingdom':'🇬🇧',Norway:'🇳🇴',Denmark:'🇩🇰',USA:'🇺🇸'};

/* Specific coffee brands you can actually buy in Germany.
   c = country the coffee comes from (for the flag); loc: 'DE' local,
   'INT' international. `roaster` drives the brand step of the picker
   (beanBrands/beansByBrand below) — pick the brand off the shelf first,
   then which of their coffees, the way you actually buy beans.

   2026-07-29 — reweighted to ~95% supermarket-shelf beans (Rewe/Edeka/Aldi/
   Lidl/Kaufland and the big roasters that stock them), since that's what
   most users actually buy; specialty roasteries kept to a handful. */
export const BEANS=[
  // ---- Jacobs ----
  {n:'Espresso',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Bold','Chocolate','Low acidity']},
  {n:'Crema Intenso',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Nutty','Balanced','Mild']},
  {n:'Barista Editions Crema',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Caramel','Smooth','Creamy']},
  {n:'Barista Editions Espresso',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Cocoa','Roasted nut','Bold']},
  {n:'Krönung',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Classic','Balanced']},
  {n:'Meisterröstung',roaster:'Jacobs',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Full-bodied','Mild acidity','Nutty']},
  // ---- Tchibo ----
  {n:'Espresso Sizilianisch Kräftig',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Dark',notes:['Intense','Dark chocolate','Bold']},
  {n:'Barista Caffè Crema',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Fruity','Mild','Smooth']},
  {n:'Barista Espresso',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Chocolate','Full-bodied','Balanced']},
  {n:'Feine Milde',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Light-medium',notes:['Mild','Nutty','Smooth']},
  {n:'Vollmundig',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Full-bodied','Low acidity','Rich']},
  {n:'Wunderbar Mild',roaster:'Tchibo',c:'Germany',loc:'DE',origin:'Blend',roast:'Light-medium',notes:['Mild','Fruity','Light']},
  // ---- Dallmayr ----
  {n:'Prodomo',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Balanced','Low acidity']},
  {n:'Crema d\'Oro Intensa',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Creamy','Chocolate','Nut']},
  {n:'Löwengold',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Classic','Mild','Aromatic']},
  {n:'Espresso Intenso',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Dark',notes:['Bold','Roasted','Chocolate']},
  // ---- Melitta ----
  {n:'BellaCrema LaCrema',roaster:'Melitta',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Smooth','Nutty','Chocolate']},
  {n:'BellaCrema Bar',roaster:'Melitta',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Intense','Cocoa','Bold']},
  {n:'BellaCrema Café Crema',roaster:'Melitta',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Fruity','Mild','Aromatic']},
  {n:'Auslese',roaster:'Melitta',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Full-bodied','Balanced','Classic']},
  // ---- Eduscho / Onko (J.J. Darboven brands) ----
  {n:'Gala Nr.1',roaster:'Eduscho',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Classic','Smooth']},
  {n:'Feinschmecker Mild',roaster:'Onko',c:'Germany',loc:'DE',origin:'Blend',roast:'Light-medium',notes:['Mild','Nutty','Light']},
  {n:'Café Intención Bio',roaster:'Onko',c:'Germany',loc:'DE',origin:'Fairtrade blend',roast:'Medium',notes:['Balanced','Cocoa','Mild']},
  {n:'Idee Kaffee Classic',roaster:'Idee Kaffee',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Traditional','Smooth']},
  {n:'Idee Kaffee Caffè Crema',roaster:'Idee Kaffee',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Fruity','Light','Aromatic']},
  // ---- Mövenpick ----
  {n:'Der Himmlische',roaster:'Mövenpick',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Aromatic','Balanced','Smooth']},
  {n:'Caffè Crema',roaster:'Mövenpick',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Fruity','Mild','Light']},
  {n:'El Espresso',roaster:'Mövenpick',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Bold','Chocolate','Rich']},
  // ---- Lavazza ----
  {n:'Qualità Rossa',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Chocolate','Dried fruit']},
  {n:'Qualità Oro',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Caramel','Honey','Floral']},
  {n:'Super Crema',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Hazelnut','Brown sugar','Mild']},
  {n:'Crema e Gusto',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Rich','Bold','Cocoa']},
  // ---- Illy ----
  {n:'Classico',roaster:'Illy',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Caramel','Chocolate','Floral']},
  {n:'Intenso',roaster:'Illy',c:'Italy',loc:'INT',origin:'Blend',roast:'Dark',notes:['Cocoa','Dried fruit','Bold']},
  // ---- Segafredo ----
  {n:'Intermezzo',roaster:'Segafredo',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Cocoa','Woody','Spice']},
  {n:'Selezione Oro',roaster:'Segafredo',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Smooth','Caramel','Mild']},
  {n:'Espresso Casa',roaster:'Segafredo',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Bold','Nutty','Balanced']},
  // ---- Kimbo ----
  {n:'Extra Cream',roaster:'Kimbo',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Creamy','Nutty','Sweet']},
  {n:'Espresso Napoletano',roaster:'Kimbo',c:'Italy',loc:'INT',origin:'Blend',roast:'Dark',notes:['Bold','Roasted','Bitter-sweet']},
  // ---- Julius Meinl ----
  {n:'Wiener Melange',roaster:'Julius Meinl',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Balanced','Nutty','Smooth']},
  {n:'Classic',roaster:'Julius Meinl',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Caramel','Mild','Aromatic']},
  // ---- Alnatura (organic, supermarket bio aisle) ----
  {n:'Bio Café Crema',roaster:'Alnatura',c:'Germany',loc:'DE',origin:'Organic blend',roast:'Medium',notes:['Fruity','Mild','Light']},
  {n:'Bio Espresso',roaster:'Alnatura',c:'Germany',loc:'DE',origin:'Organic blend',roast:'Medium-dark',notes:['Chocolate','Bold','Balanced']},
  // ---- Gepa (Fairtrade, supermarket + bio aisle) ----
  {n:'Café Crema Bio',roaster:'Gepa',c:'Germany',loc:'DE',origin:'Fairtrade organic blend',roast:'Medium',notes:['Mild','Nutty','Balanced']},
  {n:'Espresso Klassik',roaster:'Gepa',c:'Germany',loc:'DE',origin:'Fairtrade blend',roast:'Medium-dark',notes:['Cocoa','Bold','Smooth']},
  // ---- Discounter own brands ----
  {n:'Moreno Caffè Crema',roaster:'Aldi',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Fruity','Light']},
  {n:'Ristretto Espresso',roaster:'Aldi',c:'Germany',loc:'DE',origin:'Blend',roast:'Dark',notes:['Bold','Roasted','Intense']},
  {n:'Bellarom Caffè Crema',roaster:'Lidl',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Balanced','Mild','Smooth']},
  {n:'Bellarom Espresso',roaster:'Lidl',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Chocolate','Bold','Nutty']},
  {n:'Beste Wahl Caffè Crema',roaster:'Rewe',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Balanced','Light']},
  {n:'Feine Welt Espresso Sicilia',roaster:'Rewe',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Bold','Cocoa','Rich']},
  {n:'Guten Morgen Caffè Crema',roaster:'Edeka',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Fruity','Smooth']},
  {n:'Selection Espresso Perfetto',roaster:'Edeka',c:'Germany',loc:'DE',origin:'Blend',roast:'Dark',notes:['Bold','Chocolate','Intense']},
  {n:'K-Classic Caffè Crema',roaster:'Kaufland',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Balanced','Light']},
  {n:'K-Classic Espresso',roaster:'Kaufland',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Nutty','Bold','Smooth']},
  // ---- Starbucks (widely stocked in DE supermarkets) ----
  {n:'Espresso Roast',roaster:'Starbucks',c:'USA',loc:'INT',origin:'Blend',roast:'Dark',notes:['Caramelized','Rich','Bold']},
  {n:'House Blend',roaster:'Starbucks',c:'USA',loc:'INT',origin:'Blend',roast:'Medium',notes:['Balanced','Nutty','Smooth']},
  // ---- Specialty roasteries (niche, kept small on purpose) ----
  {n:'Bumblebee Espresso',roaster:'The Barn',c:'Germany',loc:'DE',origin:'Colombia · Ethiopia blend',roast:'Medium',notes:['Milk chocolate','Red berry','Caramel']},
  {n:'Buna Dimaa',roaster:'Coffee Circle',c:'Germany',loc:'DE',origin:'Ethiopia · Sidama',roast:'Light-medium',notes:['Jasmine','Blueberry','Honey']},
  {n:'Tim Wendelboe Espresso',roaster:'Tim Wendelboe',c:'Norway',loc:'INT',origin:'Seasonal',roast:'Light',notes:['Berry','Floral','Bright']}
];
/* Look up a catalog bean by (possibly partial) name.

   Exact match first, and only then a prefix match — longest candidate
   wins. Order matters here: Tim Wendelboe sells a coffee named simply
   "Espresso", and a plain `find` over prefixes let it claim every
   "Espresso Anniversario" and "Espresso Blend" in the catalogue, putting
   the wrong roaster on other people's beans. */
export function beanCatalog(name){
  if(!name) return null;
  const lc=(''+name).trim().toLowerCase();
  if(!lc) return null;
  const exact=BEANS.find(x=>x.n.toLowerCase()===lc);
  if(exact) return exact;
  return BEANS
    .filter(x=>{ const a=x.n.toLowerCase(); return lc.indexOf(a)===0 || a.indexOf(lc)===0; })
    .sort((a,b)=>b.n.length-a.n.length)[0] || null;
}

/* Sentinel brand value for a user's own logged coffees — they have no
   roaster of record, so they get their own picker slot instead of one
   of the real brands below. */
export const MY_BEANS='__mine__';

/* Brand-first lookup: a supermarket shelf (and a specialty roaster's
   lineup) both work the same way — you recognize the brand before you
   know which of their coffees you want. One entry per roaster, in
   catalog order, so the picker's brand list stays stable. */
export function beanBrands(){
  const seen=new Set(), out=[];
  BEANS.forEach(b=>{ if(!seen.has(b.roaster)){ seen.add(b.roaster); out.push({name:b.roaster,loc:b.loc,c:b.c}); } });
  return out;
}
export function beansByBrand(roaster){ return BEANS.filter(b=>b.roaster===roaster); }
