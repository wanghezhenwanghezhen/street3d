const requested=new URLSearchParams(location.search).get('quality');
export const mobileQuality=requested==='mobile'||requested!=='high'&&(matchMedia('(pointer:coarse)').matches||innerWidth<768);
export const quality={profile:mobileQuality?'mobile':'desktop',pixelRatio:mobileQuality?1:Math.min(devicePixelRatio,1.5),shadowMap:mobileQuality?1024:2048,groundTexture:mobileQuality?256:512,detailRadius:mobileQuality?5:7};
const routing=fetch('/data/texture-routing.json').then(r=>r.json());
export async function textureUrl(url){const map=await routing,p=new URL(url,location.origin);if(p.origin!==location.origin)return url;const key=decodeURI(p.pathname);return map[quality.profile==='mobile'?'mobile':'desktop'][key]??map[quality.profile==='mobile'?'mobile':'desktop'][p.pathname]??url;}
