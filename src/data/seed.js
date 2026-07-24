"use strict";
/* ============================================================
   data/seed — the seeded "world": community users, their pours,
   cafés, challenges and the leaderboard.
   In the target app this content lives in the backend and arrives
   over the network; the store treats it as the initial dataset so
   swapping in real API responses is a one-file change.
   ============================================================ */
import { S } from './assets.js';

/* ---------- community users ---------- */
export const USERS={
  me:{id:'me',name:'You',handle:'@you',color:'#8a5a30',level:1,levelName:'First Sips',city:'Tübingen',followerN:0,pourN:0,bio:''},
  mara:{id:'mara',name:'Mara Okafor',handle:'@marapours',color:'#a8544a',level:7,levelName:'Rosetta Pro',city:'Lisbon',followerN:8210,pourN:642,bio:'Free pour every morning before the kids wake up. Linea Mini loyalist.'},
  yuki:{id:'yuki',name:'Yuki Tanaka',handle:'@yukilatte',color:'#527a86',level:9,levelName:'Swan Master',city:'Osaka',followerN:15400,pourN:1204,bio:'Chasing the perfect swan since 2019. Kissaten regular, Slayer at home.'},
  tom:{id:'tom',name:'Tom Bright',handle:'@tombrews',color:'#6f7a4e',level:5,levelName:'Tulip Tinkerer',city:'Berlin',followerN:2380,pourN:311,bio:'Berlin balcony barista. Rosettas on weekdays, bikes on weekends.'},
  sofia:{id:'sofia',name:'Sofia Ricci',handle:'@sofiacrema',color:'#9a6b4a',level:6,levelName:'Rosetta Artist',city:'Milan',followerN:5120,pourN:489,bio:'Milanese espresso culture, third-wave curiosity.'},
  dev:{id:'dev',name:'Dev Patel',handle:'@devdials',color:'#7a5c8a',level:4,levelName:'Heart Artist',city:'London',followerN:940,pourN:87,bio:'Three months in. Milk texture is my nemesis. Tips welcome.'},
  lena:{id:'lena',name:'Lena Novak',handle:'@lenapours',color:'#b58a3a',level:5,levelName:'Tulip Tinkerer',city:'Vienna',followerN:1870,pourN:233,bio:'Tulip stacks and Viennese café crawls.'},
  kofi:{id:'kofi',name:'Kofi Mensah',handle:'@kofibrews',color:'#3e7a6e',level:7,levelName:'Rosetta Pro',city:'Accra',followerN:6540,pourN:731,bio:'Naked portafilter evangelist. Prep is everything.'},
  june:{id:'june',name:'June Park',handle:'@junepours',color:'#b06a8c',level:8,levelName:'Swan Apprentice',city:'Seoul',followerN:11200,pourN:958,bio:'Home café diaries from Seoul. Morning light optional but preferred.'},
  aria:{id:'aria',name:'Aria Quinn',handle:'@ariaonice',color:'#6b7ab5',level:3,levelName:'Heart Starter',city:'Melbourne',followerN:720,pourN:64,bio:'Iced everything, all year. Fight me.'}
};
/* handle → user id (mutated by the store's applyMe when the local user renames) */
export const handleToUid={}; Object.values(USERS).forEach(u=>handleToUid[u.handle.slice(1)]=u.id);

/* ---------- seed posts ---------- */
let seedId=100;
export const post=o=>({id:'p'+(seedId++),likedByMe:false,saved:false,comments:[],img:null,...o});
export const SEED_POSTS=[
  post({user:'yuki',drink:'Latte',art:true,pattern:'rosetta',quality:.97,img:S.l3,ago:'2h',caption:'Sunday pour. Milk stretched to exactly 62°C — cleanest symmetry I\'ve managed.',likes:1203,cafe:'Kissaten',
    recipe:{bean:'Kenya Nyeri AA',roaster:'Kurasu',machine:'Slayer Espresso',milk:'Whole milk',dose:'18.5g',yield:'40g',time:'30s',temp:'93°C'},
    comments:[{u:'mara',t:'The neck definition is unreal 😍',likes:24},{u:'sofia',t:'goals. absolute goals.',likes:9}]}),
  post({user:'lena',drink:'Cappuccino',art:true,pattern:'tulip',quality:.82,ago:'3h',caption:'Tulip stack #4 — Marktschenke let me behind the bar today 🙈',cafe:'Marktschenke',likes:264,
    recipe:{bean:'Colombia Huila',roaster:'The Barn',machine:'La Marzocco Linea Mini',milk:'Oat',dose:'18g',yield:'36g'},
    comments:[{u:'tom',t:'behind-the-bar privileges!! clean stacks',likes:6}]}),
  post({user:'mara',drink:'Cappuccino',art:true,pattern:'rosetta',quality:.9,img:S.l2,ago:'4h',caption:'Finally getting the contrast right. Pour high, then drop in close.',likes:342,
    recipe:{bean:'Ethiopia Guji',roaster:'The Barn',machine:'La Marzocco Linea Mini',milk:'Whole milk',dose:'18g',yield:'38g',time:'28s',temp:'93°C'},
    comments:[{u:'tom',t:'what milk are you using?',likes:3},{u:'mara',t:'@tombrews whole milk, cold jug straight from the fridge',likes:11}]}),
  post({user:'sofia',drink:'Pour-over',art:false,img:S.l9,ago:'5h',caption:'No milk today — just a clean Chemex to actually taste the Yirgacheffe. Blueberry all the way.',likes:214,
    recipe:{bean:'Ethiopia Yirgacheffe',roaster:'The Barn',machine:'Chemex'},
    comments:[{u:'tom',t:'that origin is unreal filtered',likes:5}]}),
  post({user:'dev',drink:'Cappuccino',art:true,pattern:'heart',quality:.55,img:S.l7,ago:'6h',
    caption:'Third attempt today and the art keeps sinking within seconds. Any tips on milk texture? 🙏',likes:41,
    recipe:{bean:'Brazil Cerrado',roaster:'Bonanza',machine:'Gaggia Classic Pro',dose:'17g',yield:'34g',time:'22s',temp:'90°C'},
    comments:[{u:'yuki',t:'Texture looks thin — stretch less, then swirl hard for 10s to fold the foam in.',likes:18},{u:'sofia',t:'Also pour a touch later, let the crema settle first.',likes:7}]}),
  post({user:'kofi',drink:'Espresso',art:false,img:S.l8,ago:'7h',caption:'Fresh grounds, naked portafilter, zero channeling. Bliss.',cafe:'Südhang',likes:451,
    recipe:{bean:'Kenya Nyeri AA',roaster:'Bonanza',machine:'Profitec Pro 500',dose:'18g',yield:'42g',time:'31s'},
    comments:[{u:'dev',t:'teach me your prep routine 🙏',likes:4},{u:'kofi',t:'@devdials WDT, 30 seconds, no shortcuts',likes:15}]}),
  post({user:'tom',drink:'Espresso',art:false,img:S.esp,ago:'8h',caption:'Straight double, no distractions. Finally dialled the Huila in — syrupy and sweet.',likes:132,
    recipe:{bean:'Colombia Huila',roaster:'The Barn',machine:'Rocket Appartamento',dose:'18g',yield:'40g',time:'29s'},
    comments:[{u:'dev',t:'what grinder?',likes:2}]}),
  post({user:'sofia',drink:'Cappuccino',art:true,pattern:'rosetta',quality:.83,img:S.l6,ago:'9h',caption:'Morning break at my favourite spot. Their milk is spoiling me.',likes:176,cafe:'Willi\'s',
    recipe:{bean:'Guatemala Antigua',roaster:'Five Elephant',machine:'La Marzocco Linea Mini'},
    comments:[{u:'mara',t:'that place is magic',likes:8}]}),
  post({user:'june',drink:'Flat white',art:true,pattern:'heart',quality:.93,ago:'10h',caption:'Minimal heart, maximum glow. Seoul morning light does the rest.',likes:892,
    recipe:{bean:'Ethiopia Yirgacheffe',roaster:'Kurasu',machine:'Lelit Elizabeth',milk:'Barista oat',dose:'18g',yield:'36g',time:'27s',temp:'92°C'},
    comments:[{u:'sofia',t:'that contrast 🤍',likes:21}]}),
  post({user:'dev',drink:'Cold brew',art:false,img:S.cold,ago:'12h',caption:'18h cold brew, summer staple. Didn\'t note a recipe — just eyeballed it, honestly.',likes:88,
    comments:[{u:'tom',t:'looks so refreshing',likes:3}]}),
  post({user:'aria',drink:'Iced latte',art:false,ago:'1d',caption:'Melbourne says it\'s winter. My iced latte disagrees.',likes:157,
    comments:[{u:'lena',t:'respect. iced supremacy ❄️',likes:9}]})
];
export const MYGALLERY=[];   // demo users start fresh — no pours yet; the community feed carries the app

/* ---------- Real Tübingen cafés (details are illustrative demo data) ---------- */
export const CAFES=[
  {id:'suedhang',name:'Südhang',area:'Österbergstraße · Österberg',city:'Tübingen',spec:'Hillside café & roastery',rating:4.7,followers:1120,followed:false,promo:true,img:S.l4,color:'#8a5a30',x:'32%',y:'42%',
   blurb:'A sunlit café on the Österberg with a panoramic terrace over the old town — house-roasted single origins and meticulous espresso.',hours:'Open · closes 18:00',
   menu:{beans:['Bumblebee Espresso','Espresso Anniversario'],roaster:'The Barn',machine:'La Marzocco Linea Mini',milks:['Whole milk','Barista oat','Almond']}},
  {id:'willis',name:'Willi\'s',area:'Am Lustnauer Tor · Altstadt',city:'Tübingen',spec:'Café & bar',rating:4.5,followers:860,followed:false,promo:false,img:S.l7,color:'#527a86',x:'58%',y:'30%',
   blurb:'Easy-going café-bar by the Lustnauer Tor — sharp espresso and cake through the day, natural wine after dark.',hours:'Open · closes 23:00',
   menu:{beans:['Espresso Blend'],roaster:'Five Elephant',machine:'Sage Barista Pro',milks:['Whole milk','Oat','Almond']}},
  {id:'marktschenke',name:'Marktschenke',area:'Marktplatz · Altstadt',city:'Tübingen',spec:'Old-town coffee house',rating:4.4,followers:700,followed:false,promo:false,img:S.l5,color:'#a8544a',x:'46%',y:'24%',
   blurb:'Right on the Marktplatz under the Rathaus — classic coffee-house mornings, house cakes and a terrace on the square.',hours:'Open · closes 18:30',
   menu:{beans:['Crema d\'Oro Intensa','Prodomo'],roaster:'Dallmayr',machine:'Sage Dual Boiler',milks:['Whole milk','Semi-skimmed','Oat']}},
  {id:'hanseatica',name:'Hanseatica',area:'Neckargasse · Altstadt',city:'Tübingen',spec:'Kaffeehaus & pâtisserie',rating:4.6,followers:780,followed:false,promo:true,img:S.l6,color:'#6f7a4e',x:'66%',y:'56%',
   blurb:'A refined Kaffeehaus off the Neckargasse — pâtisserie counter, filter flights and unhurried afternoons.',hours:'Open · closes 19:00',
   menu:{beans:['Bel Canto Espresso'],roaster:'Supremo',machine:'Rocket Appartamento',milks:['Whole milk','Oat','Soy']}},
  {id:'waschhaus',name:'Waschhaus',area:'Gartenstraße · am Neckar',city:'Tübingen',spec:'Café in a former washhouse',rating:4.3,followers:640,followed:false,promo:false,img:S.l1,color:'#b58a3a',x:'24%',y:'66%',
   blurb:'A characterful café in a converted washhouse by the Neckar — big communal tables, students and a steady flow of flat whites.',hours:'Open · closes 17:00',
   menu:{beans:['Dark Horse Espresso'],roaster:'Bonanza',machine:'Profitec Pro 500',milks:['Whole milk','Oat','Soy']}}
];

/* ---------- challenges & leaderboard ---------- */
export const CHALLENGES=[
  {id:'tue',title:'Tulip Tuesday',tag:'#TulipTuesday',pattern:'tulip',ends:'2d',participants:1240,joined:false,
   blurb:'Stack your best tulip this week. Clean separation between layers wins.'},
  {id:'rush',title:'Rosetta Rush',tag:'#RosettaRush',pattern:'rosetta',ends:'3d',participants:862,joined:false,
   blurb:'Seven days, one goal: the sharpest rosetta of your life.'},
  {id:'hearts',title:'Beginner Hearts',tag:'#FirstHeart',pattern:'heart',ends:'5d',participants:2103,joined:true,
   blurb:'New to latte art? Post your best heart — wobble welcome.'},
  {id:'swan',title:'Swan Sundays',tag:'#SwanSundays',pattern:'swan',ends:'6d',participants:317,joined:false,
   blurb:'The hardest pour there is. Show us your neck game.'}
];
export const LEADERBOARD=[{u:'yuki',pts:9420},{u:'june',pts:8710},{u:'mara',pts:7810},{u:'kofi',pts:7100},{u:'sofia',pts:6640},
  {u:'tom',pts:5980},{u:'lena',pts:5230},{u:'aria',pts:3990},{u:'me',pts:0}];
