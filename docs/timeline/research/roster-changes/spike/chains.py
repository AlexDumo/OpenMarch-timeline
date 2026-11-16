import sqlite3,sys,math,collections
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
pages=[r[0] for r in c.execute("select p.id from pages p join beats b on b.id=p.start_beat order by b.position")]
pos={p:{} for p in pages}
for m,p,x,y in c.execute("select marcher_id,page_id,x,y from marcher_pages"):
    if p in pos: pos[p][m]=(x,y)
def d(a,b): return math.hypot(a[0]-b[0],a[1]-b[1])
def chain(P,m,n):
    # extend from m through n and backwards; returns ordered list of ids
    def ext(a,b):
        out=[];v=(P[b][0]-P[a][0],P[b][1]-P[a][1]);cur=b;seen={a,b}
        while True:
            L=math.hypot(*v); t=(P[cur][0]+v[0],P[cur][1]+v[1])
            best=None;bd=0.3*L
            for q,pq in P.items():
                if q in seen: continue
                dq=d(pq,t)
                if dq<bd: best=q;bd=dq
            if best is None: break
            nv=(P[best][0]-P[cur][0],P[best][1]-P[cur][1])
            if abs(math.hypot(*nv)-L)>0.25*L: break
            v=nv;seen.add(best);out.append(best);cur=best
        return out
    f=ext(m,n); b=ext(n,m)
    return list(reversed(b))+[m,n]+f
tot=0;in4=0;in3=0;interior=0;alone=0;multi=0
sig={}
for p in pages:
    P=pos[p]
    for m,pm in P.items():
        tot+=1
        ds=sorted((d(pm,q),k) for k,q in P.items() if k!=m)
        d1=ds[0][0]
        if d1<1e-6: continue
        best=[];nch=0;dirs=[]
        for dist,n in ds[:6]:
            if dist>1.6*d1: break
            ch=chain(P,m,n)
            if len(ch)>=4:
                # count distinct directions
                ang=math.atan2(P[n][1]-pm[1],P[n][0]-pm[0])%math.pi
                if all(min(abs(ang-a),math.pi-abs(ang-a))>0.3 for a in dirs): dirs.append(ang);nch+=1
            if len(ch)>len(best): best=ch
        if len(best)>=4: in4+=1
        if len(best)>=3: in3+=1
        if len(best)<3: alone+=1
        if nch>=2: multi+=1
        if len(best)>=4:
            i=best.index(m)
            if 0<i<len(best)-1: interior+=1
        # signature: 3 nearest neighbor ids + offsets rounded
        near=[k for _,k in ds[:3]]
        sig[(m,p)]=(tuple(sorted(near)),tuple((round((P[k][0]-pm[0])/d1*4),round((P[k][1]-pm[1])/d1*4)) for k in sorted(near)), round(d1,1))
stops=[]
ms=set(m for (m,p) in sig)
for m in ms:
    s=0;prev=None
    for p in pages:
        g=sig.get((m,p))
        if g!=prev: s+=1
        prev=g
    stops.append(s)
# static pages: marcher didn't move from previous page
still=0;mv=0
for i in range(1,len(pages)):
    for m,pm in pos[pages[i]].items():
        q=pos[pages[i-1]].get(m)
        if q is None: continue
        mv+=1
        if d(pm,q)<1e-6: still+=1
print("pages",len(pages),"marcher-pages",tot)
print("in an evenly spaced line/curve of >=4: %.0f%%"%(100*in4/tot),"  >=3: %.0f%%"%(100*in3/tot),"  none(<3): %.0f%%"%(100*alone/tot))
print("of all, interior of a >=4 chain: %.0f%%"%(100*interior/tot),"  in 2+ chain directions (grid-like): %.0f%%"%(100*multi/tot))
print("stops per marcher (same 3 nearest neighbors, same relative offsets, same interval): mean %.1f min %d max %d of %d pages"%(sum(stops)/len(stops),min(stops),max(stops),len(pages)))
print("marcher-pages where the marcher did not move from the previous page: %.0f%%"%(100*still/mv))
