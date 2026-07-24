"use strict";
/* ============================================================
   store — the app's single source of truth.

   Owns persistent `state` (the user's world, saved via the
   persistence adapter) and transient `ui` (route, filters, open
   overlays — never persisted). Also exposes the derived selectors
   the views read from. Every read/write of persisted data goes
   through here, so the backend swap is confined to persistence.js.

   `state` and `ui` are exported as live bindings: modules that
   `import { state }` always observe the latest value, including
   after load() reassigns it on reset.
   ============================================================ */
import { clone, agoDays } from '../core/util.js';
import { beanCatalog } from '../data/catalog.js';
import { USERS, SEED_POSTS, handleToUid } from '../data/seed.js';
import { LocalStoragePersistence } from './persistence.js';

export const KEY='crema_v10';
const persistence=new LocalStoragePersistence(KEY);

export let state;
export const ui={route:'home', filter:'foryou', ovStack:[], profTab:'pours', searchQ:'', obStep:1, cafeF:{open:false,promo:false,top:false}, create:null};

export function freshState(){
  // A demo user starts like a fresh download: no pours, no followers, no streak.
  // Everyone else's world stays alive — the community feed, challenges, cafés & leaderboards are all populated.
  return {
    posts:SEED_POSTS.map(clone), myGallery:[],
    follows:{mara:false,yuki:false,sofia:false,tom:false,dev:false,lena:false,kofi:false,june:false,aria:false},
    cafeFollow:{},
    challenges:{},
    challengeSubs:{}, streak:0, customBeans:[],
    onboarded:false, theme:'auto',
    me:{name:'',handle:'',city:'Tübingen',machineBrand:'Sage',machineModel:'Bambino Plus',favDrink:'Cappuccino',favMilk:'Whole milk',premium:false,bio:''},
    notifications:[]
  };
}
export function load(){try{const s=persistence.read(); state=s&&s.posts?s:freshState();
  ['customBeans','myGallery','notifications'].forEach(k=>{if(!state[k])state[k]=[];});
  if(!state.me)state.me=freshState().me; if(!state.me.favMilk)state.me.favMilk='Whole milk'; if(!state.challengeSubs)state.challengeSubs={};
 }catch(e){state=freshState();}}
export function save(){persistence.write(state);}
export function clearSaved(){persistence.clear();}

export function findPost(id){return state.posts.find(p=>p.id===id)||(state.myGallery||[]).find(p=>p.id===id);}
export function applyMe(){
  state.me.name=(state.me.name||'').trim();
  USERS.me.name=state.me.name||'You';
  USERS.me.city=(state.me.city||'').trim();
  USERS.me.bio=state.me.bio||'';
  let h=(state.me.handle||'').replace(/\s+/g,'').replace(/^@+/,'');
  if(!h) h=USERS.me.name.toLowerCase().replace(/[^a-z0-9._]/g,'')||'you';
  USERS.me.handle='@'+h;
  handleToUid[h]='me';
}
export function freshCreate(){return{drink:state.me.favDrink||'Cappuccino',pattern:'rosetta',caption:'',img:null,source:'home',cafe:'',
  bean:'',beanCustom:'',roaster:'',machineBrand:state.me.machineBrand||'',machineModel:state.me.machineModel||'',milk:state.me.favMilk||'',dose:'',yield:'',time:'',temp:''};}

/* ---------- derived selectors (read-only views over state) ---------- */
export const allPosts=()=>[...state.posts,...(state.myGallery||[])];
export const myPosts=()=>allPosts().filter(p=>p.user==='me');
/* the user's own beans passport — grows from the beans they log, not the global catalog */
export function myBeans(){const seen=new Set(),out=[];myPosts().forEach(p=>{const b=p.recipe&&p.recipe.bean;if(b&&!seen.has(b)){seen.add(b);out.push(b);}});state.customBeans.forEach(b=>{if(b&&!seen.has(b)){seen.add(b);out.push(b);}});return out;}
export function myCountries(){return [...new Set(myBeans().map(n=>{const c=beanCatalog(n);return c&&c.c;}).filter(Boolean))];}
export function myRoasters(){const set=new Set();myBeans().forEach(n=>{const c=beanCatalog(n);if(c)set.add(c.roaster);});return [...set];}
export function feedPosts(){ return ui.filter==='following' ? state.posts.filter(p=>p.user==='me'||state.follows[p.user]) : state.posts; }
/* activity bars derive from the user's own pours (last 21 days) — empty until they post */
export function activityBars(){const a=Array(21).fill(0);myPosts().forEach(p=>{const i=20-Math.min(20,agoDays(p.ago));if(i>=0)a[i]++;});return a;}
