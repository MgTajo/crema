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
  'Bialetti':['Moka Express','Brikka','Venus'],
  'Bodum':['Chambord French Press','Pour Over'],
  'Espro':['P3 Press','Bloom Pour Over'],
  'Timemore':['French Press','U Pour Over'],
  'Other':[]
};
export const MACHINE_BRANDS=Object.keys(MACHINES);
export function combineMachine(brand,model){ if(!brand) return ''; if(brand==='Other') return (model||'').trim(); return model?brand+' '+model:''; }

export const ADD_BEAN='＋ Add your own coffee…';
export const LEVELS=[[1,'First Sips'],[2,'Steam Dreams'],[3,'Heart Starter'],[4,'Heart Artist'],[5,'Tulip Tinkerer'],
  [6,'Rosetta Artist'],[7,'Rosetta Pro'],[8,'Swan Apprentice'],[9,'Swan Master'],[10,'Latte Legend']];

/* ---------- origin flags ---------- */
export const flag={Ethiopia:'🇪🇹',Colombia:'🇨🇴',Brazil:'🇧🇷',Kenya:'🇰🇪',Guatemala:'🇬🇹',Indonesia:'🇮🇩',Peru:'🇵🇪',Rwanda:'🇷🇼','Costa Rica':'🇨🇷',Germany:'🇩🇪',Italy:'🇮🇹','United Kingdom':'🇬🇧',Norway:'🇳🇴',Denmark:'🇩🇰',USA:'🇺🇸'};

/* Specific coffee brands you can actually buy in Germany — local roasters + international.
   c = roaster's country (for the flag); loc: 'DE' local, 'INT' international. */
export const BEANS=[
  // ---- Local · roasted in Germany ----
  {n:'Bumblebee Espresso',roaster:'The Barn',c:'Germany',loc:'DE',origin:'Colombia · Ethiopia blend',roast:'Medium',notes:['Milk chocolate','Red berry','Caramel']},
  {n:'Espresso Anniversario',roaster:'The Barn',c:'Germany',loc:'DE',origin:'Seasonal blend',roast:'Medium',notes:['Cocoa','Orange','Brown sugar']},
  {n:'Dark Horse Espresso',roaster:'Bonanza',c:'Germany',loc:'DE',origin:'Seasonal blend',roast:'Medium-dark',notes:['Dark chocolate','Hazelnut','Cherry']},
  {n:'Espresso Blend',roaster:'Five Elephant',c:'Germany',loc:'DE',origin:'Brazil · Ethiopia',roast:'Medium',notes:['Chocolate','Almond','Orange']},
  {n:'Buna Dimaa',roaster:'Coffee Circle',c:'Germany',loc:'DE',origin:'Ethiopia · Sidama',roast:'Light-medium',notes:['Jasmine','Blueberry','Honey']},
  {n:'Bright Eyes Espresso',roaster:'19grams',c:'Germany',loc:'DE',origin:'Seasonal blend',roast:'Medium',notes:['Caramel','Stone fruit','Cocoa']},
  {n:'Espresso No.1',roaster:'Elbgold',c:'Germany',loc:'DE',origin:'Brazil · Guatemala',roast:'Medium',notes:['Chocolate','Nut','Brown sugar']},
  {n:'Fair Play Espresso',roaster:'Quijote Kaffee',c:'Germany',loc:'DE',origin:'Direct-trade blend',roast:'Medium',notes:['Cocoa','Nougat','Citrus']},
  {n:'Hafencity Espresso',roaster:'Speicherstadt',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Dark chocolate','Toffee','Low acidity']},
  {n:'Bel Canto Espresso',roaster:'Supremo',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Chocolate','Marzipan','Cherry']},
  {n:'Espresso Crema Classico',roaster:'Dinzler',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Nut','Caramel','Mild']},
  {n:'MVSM Espresso',roaster:'Man Versus Machine',c:'Germany',loc:'DE',origin:'Seasonal blend',roast:'Medium',notes:['Berry','Chocolate','Caramel']},
  {n:'Rocket Man Espresso',roaster:'JB Kaffee',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Cocoa','Red apple','Nut']},
  {n:'Prodomo',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Mild','Balanced','Low acidity']},
  {n:'Crema d\'Oro Intensa',roaster:'Dallmayr',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Creamy','Chocolate','Nut']},
  {n:'BellaCrema LaCrema',roaster:'Melitta',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Smooth','Nutty','Chocolate']},
  // ---- Baden-Württemberg · near Tübingen ----
  {n:'Meisterwerk Espresso',roaster:'Meisterwerk Kaffee',c:'Germany',loc:'DE',origin:'Tübingen roast · blend',roast:'Medium',notes:['Chocolate','Hazelnut','Caramel']},
  {n:'Meisterwerk Hausmischung',roaster:'Meisterwerk Kaffee',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium-dark',notes:['Cocoa','Nut','Dark sugar']},
  {n:'Herr Lutz Espresso',roaster:'Herr Lutz',c:'Germany',loc:'DE',origin:'Stuttgart roast · blend',roast:'Medium',notes:['Caramel','Berry','Chocolate']},
  {n:'Mókuska Espresso',roaster:'Mókuska Caffè',c:'Germany',loc:'DE',origin:'Stuttgart roast · blend',roast:'Medium',notes:['Chocolate','Almond','Citrus']},
  // ---- International · available in Germany ----
  {n:'Qualità Rossa',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Chocolate','Dried fruit']},
  {n:'Qualità Oro',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Caramel','Honey','Floral']},
  {n:'Super Crema',roaster:'Lavazza',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Hazelnut','Brown sugar','Mild']},
  {n:'Classico',roaster:'Illy',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium',notes:['Caramel','Chocolate','Floral']},
  {n:'Intenso',roaster:'Illy',c:'Italy',loc:'INT',origin:'Blend',roast:'Dark',notes:['Cocoa','Dried fruit','Bold']},
  {n:'Intermezzo',roaster:'Segafredo',c:'Italy',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Cocoa','Woody','Spice']},
  {n:'Red Brick Espresso',roaster:'Square Mile',c:'United Kingdom',loc:'INT',origin:'Seasonal blend',roast:'Medium',notes:['Red fruit','Caramel','Chocolate']},
  {n:'Espresso',roaster:'Tim Wendelboe',c:'Norway',loc:'INT',origin:'Seasonal',roast:'Light',notes:['Berry','Floral','Bright']},
  {n:'House Espresso',roaster:'The Coffee Collective',c:'Denmark',loc:'INT',origin:'Seasonal',roast:'Light-medium',notes:['Stone fruit','Caramel','Clean']},
  {n:'Espresso Roast',roaster:'Starbucks',c:'USA',loc:'INT',origin:'Blend',roast:'Dark',notes:['Caramelized','Rich','Bold']}
];
export const ROASTER_LIST=[...new Set(BEANS.map(b=>b.roaster))].sort().concat('Other / home roast');

/* look up a catalog bean by (possibly partial) name */
export function beanCatalog(name){return BEANS.find(x=>x.n===name||name.indexOf(x.n)===0||x.n.indexOf(name)===0)||null;}
