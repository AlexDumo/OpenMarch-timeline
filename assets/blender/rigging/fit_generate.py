import bpy, json
from mathutils import Vector

body = bpy.data.objects['OpenMarch_Body']
meta = bpy.data.objects['OpenMarch_Metarig']
meta.hide_set(False)
bpy.ops.object.select_all(action='DESELECT')
meta.select_set(True)
bpy.context.view_layer.objects.active = meta
bpy.ops.object.mode_set(mode='EDIT')
eb = meta.data.edit_bones
for name in ['breast.L', 'breast.R', 'pelvis.L', 'pelvis.R', 'spine.005']:
    eb.remove(eb[name])
coords = {}
zs = [.91, 1.065, 1.19, 1.325, 1.475]
for i in range(4):
    name = 'spine' if i == 0 else f'spine.{i:03d}'
    coords[name] = ((0, .005, zs[i]), (0, .005, zs[i+1]))
coords['spine.004'] = ((0,.005,1.475),(0,.005,1.565))
coords['spine.006'] = ((0,.005,1.565),(0,.005,1.77))
eb['spine.006'].parent = eb['spine.004']
eb['spine.006'].use_connect = True
for side, sign in [('L',1),('R',-1)]:
    def p(x,y,z): return (sign*x,y,z)
    shoulder=p(.185,.005,1.397)
    elbow=p(.268,-.014,1.211)
    wrist=p(.331,-.081, .964)
    hip=p(.094,.012,.938)
    knee=p(.130,-.022,.51)
    ankle=p(.162,.011,.096)
    ball=p(.164,-.104,.039)
    coords.update({
        'shoulder.'+side:(p(.04,.005,1.433),shoulder),
        'upper_arm.'+side:(shoulder,elbow),
        'forearm.'+side:(elbow,wrist),
        'hand.'+side:(wrist,p(.353,-.10,.867)),
        'thigh.'+side:(hip,knee),
        'shin.'+side:(knee,ankle),
        'foot.'+side:(ankle,ball),
        'toe.'+side:(ball,p(.164,-.163,.039)),
        'heel.02.'+side:(p(.126,.045,.003),p(.198,.045,.003)),
    })
for name,(head,tail) in coords.items():
    b=eb[name]; b.head=head; b.tail=tail; b.roll=0
bpy.ops.object.mode_set(mode='OBJECT')
for p in meta.pose.bones:
    if p.rigify_type.startswith('limbs.'):
        p.rigify_parameters.segments=1
        p.rigify_parameters.bbones=1
        p.rigify_parameters.rotation_axis='automatic'
meta.data.rigify_rig_basename='OpenMarch_Rig'
bpy.ops.pose.rigify_generate()
rig=bpy.context.object
rig.name='OpenMarch_Rig'
rig.data.name='OpenMarch_Rig_Skeleton'
rig.show_in_front=True
for b in rig.data.bones:
    b.bbone_segments=1
    if b.use_deform:
        b.hide_select=True
meta.hide_set(True)
meta.hide_render=True
meta.hide_select=True
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for mod in body.modifiers:
    if mod.type=='ARMATURE':
        mod.name='OpenMarch • Deform'
        mod.use_deform_preserve_volume=False
        mod.use_vertex_groups=True
        mod.use_bone_envelopes=False
result={'rig':rig.name,'bones':len(rig.data.bones),'deform':[b.name for b in rig.data.bones if b.use_deform], 'groups':[g.name for g in body.vertex_groups], 'properties':{p.name:dict(p.items()) for p in rig.pose.bones if p.keys()}}
