"use strict";
/* ============================================================
   domain/scoring — art scoring & badge rules.
   The craft logic that judges a pour and awards badges. scoreFromQ
   is pure; computeBadges reads the user's pours through store
   selectors. Portable to the target app (only the store import
   would point at the native store).
   ============================================================ */
import { clamp } from '../core/util.js';
import { state, myPosts, myBeans, myRoasters, streak } from '../store/store.js';

export function scoreFromQ(q){const b=3.6+q*6; return{total:b.toFixed(1),
  symmetry:clamp(b+(q>.7?.3:-.4),0,10).toFixed(1),contrast:clamp(b-.2,0,10).toFixed(1),definition:clamp(b+(q>.8?.2:-.2),0,10).toFixed(1)};}

export function computeBadges(){
  const mine=myPosts(), n=mine.length, pats=p=>mine.filter(x=>x.pattern===p).length;
  const beansN=myBeans().length;
  const roasters=myRoasters().length;
  return [
    {i:'☕',n:'First pour',d:'Post your first coffee',e:n>0},
    {i:'🔥',n:'Week streak',d:'7 days of coffee in a row',e:streak()>=7},
    {i:'🌿',n:'Rosetta groove',d:'Post 5 rosettas',e:pats('rosetta')>=5,p:Math.min(pats('rosetta'),5)+'/5'},
    {i:'🌷',n:'Tulip time',d:'Post your first tulip',e:pats('tulip')>=1},
    {i:'🦢',n:'Swan whisperer',d:'Post a swan',e:pats('swan')>=1,p:pats('swan')+'/1'},
    {i:'🫘',n:'Bean explorer',d:'Log 7 different beans',e:beansN>=7,p:Math.min(beansN,7)+'/7'},
    {i:'🌍',n:'Roaster hopper',d:'Try beans from 5 roasters',e:roasters>=5},
    {i:'🧊',n:'Cold brew curious',d:'Post a cold brew',e:mine.some(p=>p.drink==='Cold brew')},
    {i:'🎯',n:'Challenger',d:'Join a challenge',e:Object.values(state.challenges).some(Boolean)},
    {i:'💯',n:'Century club',d:'Log 100 pours',e:false,p:n+'/100'}];
}
