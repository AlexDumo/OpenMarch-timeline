# Run after weights_test.py in the connected Blender session.
import bpy, math, json
from mathutils import Vector, Quaternion
rig=bpy.data.objects['OpenMarch_Rig'];body=bpy.data.objects['OpenMarch_Body'];scene=bpy.context.scene
main=bpy.data.actions['Rig_Test']
if bpy.data.actions.get('Rig_IK_Check'):bpy.data.actions.remove(bpy.data.actions['Rig_IK_Check'])
action=bpy.data.actions.new('Rig_IK_Check');action.use_fake_user=True
rig.animation_data.action=action
controls=[p for p in rig.pose.bones if not p.name.startswith(('DEF-','ORG-','MCH-','VIS_'))]
def reset():
    for p in controls:p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.rotation_euler=(0,0,0);p.scale=(1,1,1)
    for s in ['L','R']:
        for limb in ['upper_arm','thigh']:
            p=rig.pose.bones[limb+'_parent.'+s];p['IK_Stretch']=0.;p['pole_vector']=True;p['IK_FK']=0.
    rig.update_tag();bpy.context.view_layer.update()
def move(name,delta):
    p=rig.pose.bones[name];mat=p.matrix.copy();mat.translation+=Vector(delta);p.matrix=mat;bpy.context.view_layer.update()
samples=[];errors=[]
for f,label in [(1,'IK neutral'),(21,'IK hands / elbow poles'),(41,'High knee flexion'),(61,'Foot roll / toe'),(81,'IK neutral')]:
    scene.frame_set(f);reset()
    if f==21:
        move('hand_ik.L',(-.06,-.24,.28));move('hand_ik.R',(.03,-.23,.20))
        move('upper_arm_ik_target.L',(.08,-.06,0))
        move('upper_arm_ik_target.R',(-.08,-.06,0))
        for s in ['L','R']:
            fore=rig.pose.bones['DEF-forearm.'+s];hand=rig.pose.bones['hand_ik.'+s]
            mat=fore.matrix @ fore.bone.matrix_local.inverted() @ hand.bone.matrix_local
            mat.translation=hand.matrix.translation;hand.matrix=mat
        bpy.context.view_layer.update()
    if f==41:
        move('torso',(0,0,-.045));move('foot_ik.L',(0,-.19,.48))
    if f==61:
        move('torso',(0,-.025,-.025))
        rig.pose.bones['foot_heel_ik.L'].rotation_euler.x=math.radians(25)
        rig.pose.bones['toe_ik.R'].rotation_quaternion=Quaternion((1,0,0),math.radians(15))
    for p in controls:
        for path in ['location','rotation_quaternion' if p.rotation_mode=='QUATERNION' else 'rotation_euler','scale']:p.keyframe_insert(path,frame=f,group=p.name)
        for prop in ['IK_FK','IK_Stretch','pole_vector']:
            if prop in p:p.keyframe_insert('["'+prop+'"]',frame=f,group=p.name)
    rig.update_tag();bpy.context.view_layer.update()
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    samples.append({'frame':f,'label':label,'vertices':[list(v.co) for v in ev.data.vertices]})
    errors.append({'frame':f,'hand_target_error':max((rig.pose.bones['DEF-hand.'+s].head-rig.pose.bones['hand_ik.'+s].head).length for s in ['L','R'])})
open('/private/tmp/openmarch_ik_samples.json','w').write(json.dumps({'faces':[list(p.vertices) for p in body.data.polygons],'poses':samples}))
rig.animation_data.action=main
scene.frame_set(1)
result={'action':action.name,'IK_errors':errors}
