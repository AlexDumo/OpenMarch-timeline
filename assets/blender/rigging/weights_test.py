import bpy, json, math, os
from mathutils import Vector, Quaternion, Matrix
rig=bpy.data.objects['OpenMarch_Rig']
body=bpy.data.objects['OpenMarch_Body']
support=os.path.join(os.path.dirname(bpy.data.filepath),'rigging')
auto=json.load(open(os.path.join(support,'reference_auto_weights.json')))
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)
clean=[]
for v,raw in zip(body.data.vertices,auto['verts']):
    x,y,z=v.co; ax=abs(x); side='L' if x>=0 else 'R'; opp='R' if side=='L' else 'L'
    w={n:a for n,a in raw['weights'].items() if a>.008}
    if z>=1.555:
        w={'DEF-spine.006':1.0}
    elif z>1.48:
        h=smooth(1.525,1.555,z); c=1-smooth(1.475,1.525,z)
        w={'DEF-spine.003':c,'DEF-spine.004':(1-c)*(1-h),'DEF-spine.006':(1-c)*h}
    elif ax>.21 and .84<z<1.31:
        # Localized elbow and wrist blending; mitten stays one rigid hand.
        hand=1-smooth(.946,.994,z)
        upper=smooth(1.17,1.255,z)
        w={'DEF-upper_arm.'+side:upper,'DEF-forearm.'+side:(1-upper)*(1-hand),'DEF-hand.'+side:(1-upper)*hand}
    elif 1.12<z<1.335 and ax<.151:
        w={n:a for n,a in w.items() if n.startswith('DEF-spine')}
    elif z<.80:
        thigh=smooth(.455,.565,z)
        shin=smooth(.074,.13,z)*(1-thigh)
        foot=max(0,1-thigh-shin)
        toe=1-smooth(-.133,-.081,y)
        w={'DEF-thigh.'+side:thigh,'DEF-shin.'+side:shin,'DEF-foot.'+side:foot*(1-toe),'DEF-toe.'+side:foot*toe}
    else:
        # Remove distant-side leakage from heat weights, retaining midline pelvis sharing.
        if ax>.018:
            w={n:a for n,a in w.items() if not n.endswith('.'+opp)}
        if z<1.12 and ax<.20:
            w={n:a for n,a in w.items() if n.startswith('DEF-spine') or n.startswith('DEF-thigh')}
        if z>1.30 and ax<.10:
            w={n:a for n,a in w.items() if n.startswith('DEF-spine') or n.startswith('DEF-shoulder')}
    w=dict(sorted(((n,a) for n,a in w.items() if a>.008),key=lambda t:-t[1])[:4])
    total=sum(w.values());assert total>0
    clean.append({n:a/total for n,a in w.items()})
# Mirror corresponding vertices exactly; geometry itself is never edited.
verts=body.data.vertices
def mirror_name(n):return n[:-2]+('.R' if n.endswith('.L') else '.L') if n.endswith(('.L','.R')) else n
mirrored=0
for v in verts:
    if v.co.x<-.00001:
        target=Vector((-v.co.x,v.co.y,v.co.z))
        mate=min(verts,key=lambda u:(u.co-target).length_squared)
        if (mate.co-target).length<.00001:
            clean[v.index]={mirror_name(n):w for n,w in clean[mate.index].items()};mirrored+=1
for g in body.vertex_groups:g.remove(list(range(len(verts))))
for i,w in enumerate(clean):
    for n,a in w.items():body.vertex_groups[n].add([i],a,'REPLACE')
for c in rig.data.collections_all:
    c.is_visible=not (c.name in ['ORG','MCH','DEF'] or 'Tweak' in c.name or ('Leg.' in c.name and '(FK)' in c.name))
modes=json.load(open(os.path.join(support,'reference_rig_modes.json')))
for p in rig.pose.bones:
    p.rotation_mode=modes[p.name]
    if p.name.startswith(('DEF-','ORG-','MCH-','VIS_')):p.bone.hide_select=True
    if p.bone.use_deform:
        c=p.constraints.get('Rigid segment scale') or p.constraints.new('COPY_SCALE')
        c.name='Rigid segment scale';c.target=rig;c.subtarget='root'
        c.target_space='POSE';c.owner_space='POSE';c.use_offset=False
    elif p.name!='root':p.lock_scale=(True,True,True)
rig['README']='See text OpenMarch_Rig_README. Arms default FK; legs IK. IK_FK 0=IK, 1=FK. Stretch disabled.'
rig['Forward']='-Y; up +Z; left +X'
rig.animation_data_create()
if bpy.data.actions.get('Rig_Test'):bpy.data.actions.remove(bpy.data.actions['Rig_Test'])
for marker in list(bpy.context.scene.timeline_markers):bpy.context.scene.timeline_markers.remove(marker)
action=bpy.data.actions.new('Rig_Test');action.use_fake_user=True
rig.animation_data.action=action
controls=[p for p in rig.pose.bones if not p.name.startswith(('DEF-','ORG-','MCH-','VIS_'))]
def reset():
    for p in controls:p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.rotation_euler=(0,0,0);p.scale=(1,1,1)
    for s in ['L','R']:
        for limb in ['upper_arm','thigh']:
            p=rig.pose.bones[limb+'_parent.'+s];p['IK_Stretch']=0.;p['pole_vector']=True
        rig.pose.bones['upper_arm_parent.'+s]['IK_FK']=1.
        rig.pose.bones['thigh_parent.'+s]['IK_FK']=0.
    rig.update_tag();bpy.context.view_layer.update()
def turn(name,axis,degrees):
    p=rig.pose.bones[name]
    # Rotation expressed around an armature-space axis, converted to local basis.
    local=p.bone.matrix_local.to_quaternion().inverted() @ Vector(axis)
    q=Quaternion(local,math.radians(degrees))
    if p.rotation_mode=='QUATERNION':p.rotation_quaternion=q
    else:p.rotation_euler=q.to_euler(p.rotation_mode)
    bpy.context.view_layer.update()
def move(name,delta):
    p=rig.pose.bones[name];mat=p.matrix.copy();mat.translation+=Vector(delta);p.matrix=mat
    bpy.context.view_layer.update()
poses=[(1,'Neutral'),(21,'Raised arms'),(41,'Bent elbows'),(61,'Lifted knee'),(81,'Planted foot / step'),(101,'Head turn'),(121,'Return to neutral')]
for f,label in poses:
    bpy.context.scene.frame_set(f);reset()
    if f==21:
        for s,sign in [('L',1),('R',-1)]:
            turn('shoulder.'+s,(0,1,0),-sign*12)
            turn('upper_arm_fk.'+s,(0,1,0),-sign*102)
            turn('forearm_fk.'+s,(1,0,0),-18)
    if f==41:
        for s in ['L','R']:
            turn('upper_arm_fk.'+s,(1,0,0),-15)
            turn('forearm_fk.'+s,(1,0,0),-105)
            turn('hand_fk.'+s,(1,0,0),15)
    if f==61:
        move('torso',(0,0,-.045))
        move('foot_ik.L',(0,-.30,.29))
        turn('forearm_fk.L',(1,0,0),-70)
        turn('upper_arm_fk.R',(1,0,0),-28)
    if f==81:
        move('torso',(0,-.035,-.035))
        move('foot_ik.R',(0,-.27,.035))
        turn('foot_heel_ik.R',(1,0,0),-12)
        turn('upper_arm_fk.L',(1,0,0),-30)
        turn('upper_arm_fk.R',(1,0,0),25)
    if f==101:
        turn('head',(0,0,1),42)
        turn('chest',(0,0,1),12)
        turn('neck',(1,0,0),8)
    for p in controls:
        for path in ['location','rotation_quaternion' if p.rotation_mode=='QUATERNION' else 'rotation_euler','scale']:p.keyframe_insert(path,frame=f,group=p.name)
        for prop in ['IK_FK','IK_Stretch','pole_vector']:
            if prop in p:p.keyframe_insert('["'+prop+'"]',frame=f,group=p.name)
    bpy.context.scene.timeline_markers.new(label,frame=f)
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=121;scene.render.fps=24
samples=[]
for f,label in poses:
    scene.frame_set(f);bpy.context.view_layer.update()
    e=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    samples.append({'frame':f,'label':label,'vertices':[list(v.co) for v in e.data.vertices]})
open('/private/tmp/openmarch_pose_samples.json','w').write(json.dumps({'faces':[list(p.vertices) for p in body.data.polygons],'poses':samples}))
scene.frame_set(1)
result={'action':action.name,'mirrored_pairs':mirrored,'max_influences':max(map(len,clean)),'pose_samples':'/private/tmp/openmarch_pose_samples.json'}
