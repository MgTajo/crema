"use strict";
/* ============================================================
   domain/framing — deciding which square of a photo survives.

   Every surface that shows a coffee photo is 1:1 (`.media`,
   `.create-prev`, `.gcell`, the week card's tiles). A photo taken in
   the app is framed by the person holding the phone; one picked from
   the gallery is whatever shape it already was, and the square used to
   be taken from its middle — which is where a panorama keeps its
   background and a tall shot keeps someone's knees. The cup went over
   the edge.

   So the crop is chosen here instead: pickFocus() reads the picture and
   proposes the square with the most detail in it, and the create sheet
   lets that proposal be dragged. Pure arithmetic over pixel arrays —
   no canvas, no DOM — so it is testable (framing.test.mjs) and ports
   with the rest of domain/.

   `focus` throughout is one number in 0..1: where the square sits along
   whichever axis overflows. 0 is flush left/top, 1 flush right/bottom,
   .5 the old centre crop. It is deliberately the same quantity CSS
   `object-position` takes as a percentage, so the preview and the baked
   canvas cannot drift apart — see objectPosition().
   ============================================================ */

const clamp01 = v => v<0?0:v>1?1:(v||0);

/* The square to cut, in source pixels. One of the two overflows is
   always zero, so the same line does landscape and portrait. */
export function cropSquare(iw, ih, focus=0.5){
  const size=Math.min(iw,ih), f=clamp01(focus);
  return { size, sx: Math.round(f*(iw-size)), sy: Math.round(f*(ih-size)) };
}

/* The same crop, expressed for an <img> with object-fit:cover in a
   square box. Identical maths, so what the sheet shows is what the
   canvas bakes. */
export function objectPosition(iw, ih, focus=0.5){
  const p=(clamp01(focus)*100).toFixed(2)+'%';
  if(iw>ih) return `${p} 50%`;
  if(ih>iw) return `50% ${p}`;
  return '50% 50%';
}

/* Is there anything to choose? A square photo has exactly one crop, so
   the sheet doesn't offer to reframe it. 2% of slack counts as square —
   that much is a rounding artefact, not a decision. */
export function isAdjustable(iw, ih){
  if(!iw||!ih) return false;
  return Math.max(iw,ih)/Math.min(iw,ih) > 1.02;
}

/* How far a drag of `dpx` across a square preview box of side `box`
   moves the focus. Dragging the picture right reveals what is to its
   left, so the sign is inverted — the photo follows the finger. */
export function focusAfterDrag(iw, ih, focus, dx, dy, box){
  const scale=box/Math.min(iw,ih);
  const overflow=(iw>ih?iw:ih)*scale-box;
  if(overflow<=0) return clamp01(focus);
  return clamp01(focus - (iw>ih?dx:dy)/overflow);
}

/* ---------- choosing the square ----------
   Cheap saliency: a coffee is the high-contrast thing in the frame —
   a dark disc of crema, a rim, latte art — while the parts that can be
   thrown away are table, wall, sky, bokeh. So the score of a candidate
   square is the gradient energy inside it, and the winner keeps the
   most of it.

   `luma` is a row-major grayscale array (w*h, 0..255) of a thumbnail —
   64px on the long side is plenty, and keeps this well under a frame
   even on a slow phone.

   The centre bias is what stops the result being worse than the centre
   crop it replaces: a busy edge (a radiator, a bookshelf) can out-score
   the subject, and a photographer's own framing is real information.
   Detail has to win by a margin to move the square, not by a hair. */
const CENTRE_BIAS = 0.28;

export function pickFocus(luma, w, h){
  if(!luma || w<2 || h<2) return 0.5;
  const size=Math.min(w,h), overflow=Math.max(w,h)-size;
  if(overflow<=0) return 0.5;
  const landscape=w>h;

  /* Gradient magnitude, summed into one bucket per column (landscape)
     or per row (portrait) — the axis we are free to slide along. */
  const line=new Float64Array(landscape?w:h);
  for(let y=0;y<h-1;y++){
    for(let x=0;x<w-1;x++){
      const i=y*w+x;
      const e=Math.abs(luma[i]-luma[i+1])+Math.abs(luma[i]-luma[i+w]);
      line[landscape?x:y]+=e;
    }
  }

  /* Prefix sums, so every candidate window is two lookups. */
  const pre=new Float64Array(line.length+1);
  for(let i=0;i<line.length;i++) pre[i+1]=pre[i]+line[i];

  const score=s=>{
    const energy=pre[s+size]-pre[s];
    /* 0 at the centre, 1 at either extreme. */
    const off=Math.abs((s+size/2)-(line.length/2))/(overflow/2);
    return energy*(1-CENTRE_BIAS*off);
  };
  /* The centre crop is the incumbent and ties go to it, so a picture
     with nothing to say — a flat wall, a blurred backdrop — comes back
     framed the way it always was rather than flush against an edge. */
  let best=Math.round(overflow/2), bestScore=score(best);
  for(let s=0;s<=overflow;s++){
    const sc=score(s);
    if(sc>bestScore){ bestScore=sc; best=s; }
  }
  return clamp01(best/overflow);
}
