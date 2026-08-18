"use strict";
/* ============================================================
   data/catalog — static reference data ("the menu").
   Drinks, milks, machines, levels, purchasable beans and the country
   flags. In the target app a backend serves this read-only catalog;
   here it is bundled. No app state lives here.
   ============================================================ */

/* The German copy, read directly rather than through t(). The search
   index below has to match a word in EITHER language regardless of
   which one the app is currently set to — the index is built once and
   a language switch must not silently stop finding things — so both
   spellings go into the haystack together. i18n.de.js imports nothing,
   so this stays a leaf-to-leaf dependency. */
import { DE } from '../i18n.de.js';
const both = s => s ? s+' '+(DE[s]||'') : '';

/* ---------- drinks ---------- */
export const DRINKS=['Cappuccino','Latte','Flat white','Cortado','Piccolo','Mocha','Macchiato',
  'Espresso','Doppio','Americano','Long black','Pour-over','Filter','Cold brew','Aeropress','Iced latte'];
export const MILK_DRINKS=new Set(['Cappuccino','Latte','Flat white','Cortado','Piccolo','Mocha','Macchiato']);
export const DRINK_ART=Object.fromEntries(DRINKS.map(d=>[d,MILK_DRINKS.has(d)]));
export const HAS_MILK=new Set([...MILK_DRINKS,'Iced latte']);   // drinks where milk type matters
export const MILK_LIST=['Whole milk','Semi-skimmed','Skimmed','Lactose-free','Oat','Barista oat','Almond','Soy','Coconut'];

/* Every drink here is free to pick. It used to be an everyday six with
   the rest behind Premium, which put a paywall between someone and an
   honest record of what they drank — a Mocha you can't say you had makes
   the log wrong, not the account upgraded. Premium's line is the shelf
   (pins, your own drink names), never the truth. */

/* Sentinel for a Premium user's own drink type: picking it swaps the
   dropdown for a text field, and the name they type is remembered
   (state.customDrinks) so it rejoins the dropdown as a normal choice
   next time, for them only. Naming a drink nobody else has is
   personalization — that part stays Premium. */
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

/* A handful of machines that cover a lot of kitchens, shown before any
   search has been typed. Deliberately spread across price and method —
   a super-automatic, a moka pot and an AeroPress belong on the same
   shortlist, because "popular" here means "likely yours", not "best". */
export const POPULAR_MACHINES=[
  ['Sage','Bambino Plus'],['DeLonghi','Dedica'],['Rancilio','Silvia'],['Gaggia','Classic Evo Pro'],
  ['Bialetti','Moka Express'],['AeroPress','Original'],['Hario','V60'],['Philips','Series 3200 LatteGo'],
  ['Jura','ENA 8'],['Sage','Barista Express'],['Lelit','Bianca'],['Moccamaster','KBGV Select']];

/* ============================================================
   What a machine actually is.

   Every brewer in the list above gets the same four facts, because a
   picker row that says "Bialetti Moka Express" tells someone who owns
   one nothing they didn't know, and someone who doesn't own one
   nothing at all. These four answer "what am I looking at" without
   turning into a spec sheet: what kind of thing it is, how it makes
   the coffee, whether it can do milk, and where the brand is from.

   Claimed at the level they are actually true. The *type* of a Jura is
   a fact about every Jura; the boiler layout of one Rocket model is
   not, so it isn't here. Where a brand spans two kinds of machine —
   DeLonghi sells both a Dedica and a Magnifica — the model says which
   (MODEL_KIND below), and nothing is guessed from the model name.

   Nothing here is per-model marketing. If we don't know, machineInfo()
   returns null and the sheet says so rather than inventing a spec. */
export const MACHINE_KINDS={
  espresso: {label:'Espresso machine',       method:'Pump pressure, around 9 bar',        milk:'Steam wand'},
  auto:     {label:'Bean-to-cup',            method:'Grinds, doses and brews at a button', milk:'Built in, varies by model'},
  lever:    {label:'Lever espresso machine',  method:'Pressure by hand, on a piston',      milk:'Steam wand'},
  press:    {label:'Manual espresso press',   method:'Pressure by hand, no electricity',   milk:'None'},
  portable: {label:'Portable espresso maker', method:'Hand-pumped, made to travel',        milk:'None'},
  moka:     {label:'Moka pot',                method:'Steam pressure, on the stove',       milk:'None'},
  pourover: {label:'Pour-over dripper',       method:'Gravity, poured by hand',            milk:'None'},
  press_fr: {label:'French press',            method:'Full immersion, then pressed',       milk:'None'},
  filter:   {label:'Filter coffee brewer',    method:'Gravity, poured for you',            milk:'None'},
  aero:     {label:'Immersion brewer',        method:'Steeped, then pushed through a filter', milk:'None'}
};

/* brand → [kind, where the brand is from]. The country is the brand's
   home, not where a given unit was assembled — that is the fact people
   mean when they ask, and the only one that stays true per brand. */
const BRAND_INFO={
  'La Marzocco':['espresso','Italy'], 'Rocket Espresso':['espresso','Italy'], 'ECM':['espresso','Germany'],
  'Profitec':['espresso','Germany'], 'Lelit':['espresso','Italy'], 'Rancilio':['espresso','Italy'],
  'Gaggia':['espresso','Italy'], 'Sage':['espresso','Australia'], 'Breville':['espresso','Australia'],
  'Ascaso':['espresso','Spain'], 'Quick Mill':['espresso','Italy'], 'Bezzera':['espresso','Italy'],
  'Nuova Simonelli':['espresso','Italy'], 'Victoria Arduino':['espresso','Italy'],
  'DeLonghi':['auto','Italy'], 'Jura':['auto','Switzerland'], 'Philips':['auto','Netherlands'],
  'Siemens':['auto','Germany'], 'Melitta':['auto','Germany'], 'Saeco':['auto','Italy'],
  'Nivona':['auto','Germany'], 'Miele':['auto','Germany'], 'Krups':['auto','Germany'],
  'Bosch':['auto','Germany'], 'WMF':['auto','Germany'], 'Gastroback':['espresso','Germany'],
  'Flair':['press','USA'], 'La Pavoni':['lever','Italy'], 'Cafelat':['press','Hong Kong'],
  'Wacaco':['portable','Hong Kong'],
  'Hario':['pourover','Japan'], 'Chemex':['pourover','USA'], 'AeroPress':['aero','USA'],
  'Fellow':['pourover','USA'], 'Kalita':['pourover','Japan'], 'Origami':['pourover','Japan'],
  'Moccamaster':['filter','Netherlands'],
  'Bialetti':['moka','Italy'], 'Grosche':['moka','Canada'], 'Cilio':['moka','Germany'], 'Bugatti':['moka','Italy'],
  'Bodum':['press_fr','Denmark'], 'Espro':['press_fr','Canada'], 'Timemore':['press_fr','China']
};

/* The brands that sell more than one kind of thing. Keyed "Brand Model",
   because that is the string a recipe stores. Anything not listed takes
   its brand's kind. */
const MODEL_KIND={
  'DeLonghi Dedica':'espresso', 'DeLonghi La Specialista Arte':'espresso',
  'DeLonghi La Specialista Maestro':'espresso', 'DeLonghi La Specialista Opera':'espresso',
  'Gaggia Classic Evo Pro':'espresso', 'Gaggia Classic Pro':'espresso',
  'Gaggia Cadorna Prestige':'auto', 'Gaggia Anima':'auto', 'Gaggia Magenta Plus':'auto',
  'WMF Kitchenminis Aroma':'filter',
  'Grosche Zurich French Press':'press_fr',
  'Bodum Pour Over':'pourover', 'Espro Bloom Pour Over':'pourover', 'Timemore U Pour Over':'pourover'
};

/* What we can say about one machine, or null when it isn't ours to
   describe — someone's own entry, or a brand with no row above. The
   caller shows what it gets; nothing is filled in with a guess. */
export function machineInfo(label){
  const s=(label||'').trim(); if(!s) return null;
  const {brand,model}=splitMachine(s);
  if(!brand||brand==='Other') return null;
  const b=BRAND_INFO[brand]; if(!b) return null;
  const kind=MODEL_KIND[brand+(model?' '+model:'')]||b[0];
  const k=MACHINE_KINDS[kind]; if(!k) return null;
  return { brand, model, kind, label:k.label, method:k.method, milk:k.milk, country:b[1] };
}

/* [level, name, points needed to reach it]. Each step costs roughly 1.5x
   the one before, so Level 2 is ten pours away and Level 10 is a real
   milestone. This table mirrors level_for_points() in
   platform/supabase/step-1.9.sql — the database is the authority, this copy draws
   the progress bar. Keep them in step. */
export const LEVELS=[[1,'First Sips',0],[2,'Steam Dreams',100],[3,'Heart Starter',250],[4,'Heart Artist',500],
  [5,'Tulip Tinkerer',900],[6,'Rosetta Artist',1500],[7,'Rosetta Pro',2400],[8,'Swan Apprentice',3800],
  [9,'Swan Master',6000],[10,'Latte Legend',9500]];

/* ---------- origin flags ---------- */
export const flag={Ethiopia:'🇪🇹',Colombia:'🇨🇴',Brazil:'🇧🇷',Kenya:'🇰🇪',Guatemala:'🇬🇹',Indonesia:'🇮🇩',Peru:'🇵🇪',Rwanda:'🇷🇼','Costa Rica':'🇨🇷',Germany:'🇩🇪',Italy:'🇮🇹','United Kingdom':'🇬🇧',Norway:'🇳🇴',Denmark:'🇩🇰',USA:'🇺🇸',
  Sweden:'🇸🇪',Netherlands:'🇳🇱',Belgium:'🇧🇪',Finland:'🇫🇮',Portugal:'🇵🇹',Spain:'🇪🇸',Switzerland:'🇨🇭',Japan:'🇯🇵',Australia:'🇦🇺',Canada:'🇨🇦',India:'🇮🇳',Vietnam:'🇻🇳',Turkey:'🇹🇷'};

/* Specific coffee brands you can actually buy in Germany.
   c = country the coffee comes from (for the flag); loc: 'DE' local,
   'INT' international. `roaster` drives the brand step of the picker
   (beanBrands below) — one shortcut into the search, for people who
   recognize the bag on the shelf before they can name the coffee.

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
  {n:'Tim Wendelboe Espresso',roaster:'Tim Wendelboe',c:'Norway',loc:'INT',origin:'Seasonal',roast:'Light',notes:['Berry','Floral','Bright']},
  // ---- 2026-08-07 — more German specialty, and more of the world ----
  {n:'Berlin Kreuzberg',roaster:'Bonanza Coffee Roasters',c:'Germany',loc:'DE',origin:'Seasonal single origin',roast:'Light',notes:['Bright','Fruity','Clean']},
  {n:'Filter No.1',roaster:'Five Elephant',c:'Germany',loc:'DE',origin:'Seasonal single origin',roast:'Light-medium',notes:['Sweet','Balanced','Fruity']},
  {n:'Hamburg Blend',roaster:'19grams',c:'Germany',loc:'DE',origin:'Blend',roast:'Medium',notes:['Chocolate','Nutty','Balanced']},
  // ---- International supermarket & mainstream brands ----
  {n:'Original Roast',roaster:'Douwe Egberts',c:'Netherlands',loc:'INT',origin:'Blend',roast:'Medium',notes:['Smooth','Balanced','Classic']},
  {n:'Aroma Rood',roaster:'Douwe Egberts',c:'Netherlands',loc:'INT',origin:'Blend',roast:'Medium',notes:['Mild','Nutty','Light']},
  {n:'Mocca Cream',roaster:'Löfbergs',c:'Sweden',loc:'INT',origin:'Blend',roast:'Medium',notes:['Sweet','Mild','Smooth']},
  {n:'Mörkrost',roaster:'Gevalia',c:'Sweden',loc:'INT',origin:'Blend',roast:'Dark',notes:['Bold','Roasted','Rich']},
  {n:'Presidentti',roaster:'Paulig',c:'Finland',loc:'INT',origin:'Blend',roast:'Light-medium',notes:['Light','Clean','Mild']},
  {n:'Juhla Mokka',roaster:'Paulig',c:'Finland',loc:'INT',origin:'Blend',roast:'Medium',notes:['Balanced','Nutty','Mild']},
  {n:'Delta Blend',roaster:'Delta Cafés',c:'Portugal',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Bold','Chocolate','Rich']},
  {n:'Café Rombouts',roaster:'Rombouts',c:'Belgium',loc:'INT',origin:'Blend',roast:'Medium',notes:['Balanced','Nutty','Mild']},
  {n:'Café Especial',roaster:'Nomad Coffee',c:'Spain',loc:'INT',origin:'Single origin, seasonal',roast:'Light',notes:['Bright','Fruity','Floral']},
  {n:'Kaffeemacher Espresso',roaster:'Kaffeemacher',c:'Switzerland',loc:'INT',origin:'Blend',roast:'Medium',notes:['Balanced','Cocoa','Smooth']},
  {n:'Juan Valdez Selección',roaster:'Juan Valdez',c:'Colombia',loc:'INT',origin:'Colombia',roast:'Medium',notes:['Caramel','Citrus','Balanced']},
  {n:'Café Britt Tarrazú',roaster:'Café Britt',c:'Costa Rica',loc:'INT',origin:'Costa Rica · Tarrazú',roast:'Medium',notes:['Bright','Citrus','Chocolate']},
  {n:'Trung Nguyên Espresso Roast',roaster:'Trung Nguyên',c:'Vietnam',loc:'INT',origin:'Vietnam · Robusta blend',roast:'Dark',notes:['Bold','Earthy','Low acidity']},
  {n:'Kurukahveci Mehmet Efendi',roaster:'Kurukahveci Mehmet Efendi',c:'Turkey',loc:'INT',origin:'Blend, fine-ground',roast:'Medium-dark',notes:['Rich','Spiced','Traditional']},
  {n:'Blue Tokai South Indian',roaster:'Blue Tokai',c:'India',loc:'INT',origin:'India · Chikmagalur',roast:'Medium',notes:['Spicy','Malty','Full-bodied']},
  {n:'Kicking Horse Kick Ass',roaster:'Kicking Horse',c:'Canada',loc:'INT',origin:'Blend',roast:'Dark',notes:['Bold','Smoky','Intense']},
  {n:'Vittoria Espresso',roaster:'Vittoria Coffee',c:'Australia',loc:'INT',origin:'Blend',roast:'Medium-dark',notes:['Chocolate','Nutty','Balanced']},
  {n:'Market Lane Filter Blend',roaster:'Market Lane',c:'Australia',loc:'INT',origin:'Seasonal single origin',roast:'Light',notes:['Berry','Floral','Bright']},
  {n:'Onibus Blend',roaster:'Onibus Coffee',c:'Japan',loc:'INT',origin:'Seasonal single origin',roast:'Light-medium',notes:['Delicate','Clean','Floral']},
  {n:'Major Dickason\'s Blend',roaster:'Peet\'s Coffee',c:'USA',loc:'INT',origin:'Blend',roast:'Dark',notes:['Bold','Rich','Full-bodied']},
  {n:'Hair Bender',roaster:'Stumptown',c:'USA',loc:'INT',origin:'Latin America · East Africa blend',roast:'Medium',notes:['Chocolate','Citrus','Complex']},
  {n:'Monarch',roaster:'Onyx Coffee Lab',c:'USA',loc:'INT',origin:'Blend',roast:'Medium',notes:['Sweet','Balanced','Cocoa']},
  {n:'Revelation Espresso',roaster:'Union Hand-Roasted Coffee',c:'United Kingdom',loc:'INT',origin:'Blend',roast:'Medium',notes:['Sweet','Balanced','Red fruit']},
  {n:'Monmouth Espresso',roaster:'Monmouth Coffee',c:'United Kingdom',loc:'INT',origin:'Blend',roast:'Medium',notes:['Nutty','Sweet','Smooth']},
  {n:'Ethiopia Filter',roaster:'Drop Coffee',c:'Sweden',loc:'INT',origin:'Ethiopia',roast:'Light',notes:['Jasmine','Citrus','Tea-like']},
  {n:'Filter Blend',roaster:'The Coffee Collective',c:'Denmark',loc:'INT',origin:'Seasonal single origin',roast:'Light',notes:['Bright','Fruity','Floral']},
  {n:'Oslo Filter',roaster:'Fuglen',c:'Norway',loc:'INT',origin:'Blend',roast:'Light',notes:['Crisp','Fruity','Clean']}
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

/* ---------- what a coffee actually is ----------
   Same idea as machineInfo(): the bean sheet should answer "what am I
   looking at" for every bag in the catalogue, not only for the three
   specialty ones somebody wrote a paragraph about.

   Both helpers below are READINGS of columns the catalogue already
   has — a roast level said as a position on a scale, an origin line
   said as blend or single origin. Nothing is inferred about how a
   coffee tastes or what it is best brewed on: the notes are the
   roaster's claim and are shown as theirs, and a guess dressed as a
   fact would be worse than a blank row. */
const ROAST_STEPS=['Light','Light-medium','Medium','Medium-dark','Dark'];
export const ROAST_MAX=ROAST_STEPS.length;
export const roastStep = r => ROAST_STEPS.indexOf((r||'').trim())+1;   // 0 when unknown

/* "Fairtrade organic blend" says blend; "Ethiopia · Sidama" names one
   country and says single origin; "Seasonal" on its own says neither,
   and gets nothing rather than a coin toss. */
export function beanKind(origin){
  const o=(origin||'').trim(); if(!o) return '';
  const lc=o.toLowerCase();
  if(lc.includes('blend')) return 'Blend';
  if(lc.includes('single origin')) return 'Single origin';
  return flag[(o.split('·')[0]||'').trim()] ? 'Single origin' : '';
}

/* Everything the app knows about one coffee, or null for a coffee it
   has never heard of — someone's own bag, which carries whatever they
   chose to write down instead (see store/store.js gearNote). */
export function beanInfo(name){
  const c=beanCatalog(name); if(!c) return null;
  return { ...c, kind:beanKind(c.origin), step:roastStep(c.roast) };
}

/* One entry per roaster, in catalog order, so the picker's "browse by
   roaster" list stays stable. Browsing is a shortcut into the search,
   not a step you have to pass through. */
export function beanBrands(){
  const seen=new Set(), out=[];
  BEANS.forEach(b=>{ if(!seen.has(b.roaster)){ seen.add(b.roaster); out.push({name:b.roaster,loc:b.loc,c:b.c}); } });
  return out;
}

/* Coffees worth offering before anyone has typed anything: the bags that
   are actually on a German supermarket shelf this morning.

   Read through popularBeans(), never directly — BEANS is refilled from
   the server at startup (data/remote.js), so any name here may simply
   not be in the catalogue the app is running on. Offering a coffee the
   catalogue doesn't have would hand back a pick with no roaster and no
   bean page behind it, so unknown names drop out and the head of the
   real catalogue stands in if none survive. */
const POPULAR_BEAN_NAMES=['Krönung','Prodomo','Qualità Rossa','BellaCrema LaCrema',
  'Bellarom Caffè Crema','Espresso Sizilianisch Kräftig','Classico','Moreno Caffè Crema'];
export function popularBeans(){
  const have=new Set(BEANS.map(b=>b.n));
  const hits=POPULAR_BEAN_NAMES.filter(n=>have.has(n));
  return hits.length?hits:BEANS.slice(0,8).map(b=>b.n);
}

/* ============================================================
   Finding one thing in a catalogue that only ever grows.

   Neither list can ever be complete — there are more machines than we
   will ever type out and a new roastery every week — so the answer is
   never a longer dropdown. It is: search what we do have, flatly, and
   let people add what we don't (see the picker in ui/overlays.js).
   ============================================================ */

/* Fold a string down to something two people spell the same way.

   German is the whole reason this is not just toLowerCase(): the
   catalogue says Krönung and Mövenpick, and a phone keyboard at 7am
   types "kronung" or "kroenung". Both transliterations collapse to the
   same thing here, and because the SAME fold runs over the haystack and
   the needle, the two can't drift apart. */
export function norm(s){
  return (s||'').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')   // ö → o, à → a
    .replace(/ß/g,'ss')
    .replace(/oe/g,'o').replace(/ae/g,'a').replace(/ue/g,'u')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

/* One flat row per machine — "Rancilio Silvia", not Rancilio → Silvia.
   Searching the pair together is the point: nobody remembers that Silvia
   is a Rancilio or that Bellarom is Lidl's, and a brand-first list makes
   knowing that the price of finding your own machine. */
let _machineIdx=null;
export function machineIndex(){
  if(_machineIdx) return _machineIdx;
  const out=[];
  MACHINE_BRANDS.forEach(b=>{
    if(b==='Other') return;
    const models=MACHINES[b]||[];
    if(!models.length) out.push({brand:b,model:'',label:b,sub:''});
    else models.forEach(m=>out.push({brand:b,model:m,label:b+' '+m,sub:b}));
  });
  /* What the thing IS goes in the haystack too. Half the people looking
     for a Bialetti Brikka don't know the word Brikka — they know they
     own a moka pot, and "moka" finding nothing while the app holds six
     of them is the search being wrong, not the person. */
  out.forEach(x=>{ const i=machineInfo(x.label); x.hay=norm(x.label+' '+both(i?i.label:'')); });
  return (_machineIdx=out);
}

/* Rebuilt rather than remembered when the coffee list changes under it:
   BEANS is refilled in place from the server (data/remote.js apply()),
   and an index built before that lands would leave the picker searching
   a catalogue the app is no longer using — every coffee the server added
   invisible, every one it dropped still offered. */
let _beanIdx=null;
export function invalidateBeanIndex(){ _beanIdx=null; }
export function beanIndex(){
  if(_beanIdx) return _beanIdx;
  const out=BEANS.map(b=>({
    brand:b.roaster, name:b.n, label:b.n, sub:b.roaster,
    /* Origin and tasting notes are searchable too, so "ethiopia" or
       "fruity" finds a bag whose name gives none of that away. */
    hay:norm([b.n,b.roaster,both(b.c),b.origin,(b.notes||[]).join(' ')].join(' '))
  }));
  return (_beanIdx=out);
}

/* Rank by how early the match lands, not just whether it does: typing
   "sil" should put Silvia above Silvano Evo above anything that merely
   contains those letters. Every token has to appear somewhere, so
   "sage bar" narrows instead of widening. */
function rankHits(items,q,limit){
  const nq=norm(q);
  if(!nq) return items.slice(0,limit);
  const toks=nq.split(' ').filter(Boolean);
  const out=[];
  items.forEach(it=>{
    if(!toks.every(t=>it.hay.includes(t))) return;
    const words=it.hay.split(' ');
    const score = it.hay===nq ? 0
      : it.hay.startsWith(nq) ? 1
      : words.some(w=>w.startsWith(toks[0])) ? 2 : 3;
    out.push({it,score});
  });
  return out.sort((a,b)=>a.score-b.score || a.it.label.length-b.it.label.length
                       || a.it.label.localeCompare(b.it.label))
    .slice(0,limit).map(x=>x.it);
}
export function searchMachines(q,limit=60){ return rankHits(machineIndex(),q,limit); }
export function searchBeans(q,limit=60){ return rankHits(beanIndex(),q,limit); }

/* The same ranking over a plain list of strings — the shelf of things
   someone typed in themselves. Without it, a search that reaches the
   whole catalogue still cannot find the bag you added yesterday, which
   is the one coffee you are most likely to be looking for. */
export function searchOwn(list,q,limit=12){
  const items=(list||[]).map(v=>({label:v,name:v,brand:'',sub:'',hay:norm(v)}));
  return rankHits(items,q,limit).map(x=>x.label);
}

/* Does the catalogue already hold exactly this? Decides whether the
   picker offers "add it as your own" — offering to add a coffee that is
   already on the list one row above reads as the search being broken. */
export const machineKnown = label => machineIndex().some(x=>x.hay===norm(label));
export const beanKnown     = label => beanIndex().some(x=>norm(x.name)===norm(label));
