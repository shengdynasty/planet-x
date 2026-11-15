# Re-encode the level 3-6 WebP tile set (scripts/make-sky-tiles.py output) as AVIF. This made the q42 set (levels 3-5 full sky, level 6 split in two halves).
# usage: python scripts/reencode-tiles-avif.py 42 3   (quality, speed); edit SRC/OUT at the top. Run with a Pillow that has AVIF.
import os,sys,json
from concurrent.futures import ProcessPoolExecutor
from PIL import Image
SRC='skytiles_webp_full'; OUT='skytiles_q42'; Q=int(sys.argv[1]); SP=int(sys.argv[2])
def job(a):
    l,c,r=a; d=f'{OUT}/{l}'; os.makedirs(d,exist_ok=True); o=f'{d}/{c}_{r}.avif'
    if os.path.exists(o): return l,os.path.getsize(o)
    Image.open(f'{SRC}/{l}/{c}_{r}.webp').convert('RGB').save(o+'.tmp','AVIF',quality=Q,speed=SP); os.replace(o+'.tmp',o); return l,os.path.getsize(o)
def main():
    jobs=[(l,c,r) for l in (3,4,5,6) for c in range(2**(l+1)) for r in range(2**l)]
    tot={}
    with ProcessPoolExecutor(max(1,os.cpu_count()-2)) as ex:
        for i,(l,sz) in enumerate(ex.map(job,jobs,chunksize=32)):
            tot[l]=tot.get(l,0)+sz
            if i%1000==0: print(i,len(jobs),{k:round(v/1e6,1) for k,v in tot.items()},flush=True)
    print('DONE',{k:round(v/1e6,1) for k,v in tot.items()},round(sum(tot.values())/1e6,1))
    m=json.load(open(f'{SRC}/manifest.json')); m['ext']='avif'; json.dump(m,open(f'{OUT}/manifest.json','w'),indent=1)
if __name__=='__main__': main()
