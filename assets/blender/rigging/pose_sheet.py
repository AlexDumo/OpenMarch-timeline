import json, math
from PIL import Image,ImageDraw,ImageFont
data=json.load(open('/private/tmp/openmarch_pose_samples.json'))
def sub(a,b):return [x-y for x,y in zip(a,b)]
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
for view,angle in [('front',0),('threequarter',.55),('side',math.pi/2)]:
    im=Image.new('RGB',(1500,1400),(32,37,46));d=ImageDraw.Draw(im)
    right=(math.cos(angle),math.sin(angle),0);depth=(-math.sin(angle),math.cos(angle),0)
    for k,pose in enumerate(data['poses'][:6]):
        x0=(k%3)*500;y0=(k//3)*700
        d.text((x0+20,y0+20),f"{pose['frame']:03d}  {pose['label']}  /  {view}",fill=(230,235,242))
        v=pose['vertices']
        def screen(p):return (x0+250+dot(p,right)*310,y0+645-p[2]*310)
        d.line((x0+20,y0+645,x0+480,y0+645),fill=(70,80,90),width=1)
        for f in sorted(data['faces'],key=lambda f:-sum(dot(v[i],depth) for i in f)/len(f)):
            a,b,c=[v[i] for i in f[:3]];n=cross(sub(b,a),sub(c,a));length=math.sqrt(dot(n,n));n=[q/max(length,1e-12) for q in n]
            light=.55+.45*max(0,dot(n,(-.35,-.65,.67)))
            color=tuple(int(c*light) for c in (120,151,209))
            d.polygon([screen(v[i]) for i in f],fill=color)
    im.save('/private/tmp/rig_test_'+view+'.png')
