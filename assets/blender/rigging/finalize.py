import bpy,os
from mathutils import Quaternion
base=os.path.dirname(bpy.data.filepath)
for name,path in [('OpenMarch_Rig_README','rigging/README.md'),('OpenMarch_Bake_Export.py','rigging/bake_export.py')]:
    t=bpy.data.texts.get(name) or bpy.data.texts.new(name)
    t.clear();t.write(open(os.path.join(base,path)).read());t.use_fake_user=True
rig=bpy.data.objects['OpenMarch_Rig']
rig['README']='Text Editor: OpenMarch_Rig_README. Default: FK arms, IK legs. Bake helper and companion exports in rigging/ and exports/.'
if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
rig.animation_data.action=bpy.data.actions['Rig_Test']
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='DESELECT')
rig.data.bones.active=rig.data.bones['root'];rig.pose.bones['root'].select=True
rig.pose.bones['root'].custom_shape_scale_xyz=(.45,.45,.45)
for p in rig.pose.bones:
    if p.name.startswith(('upper_arm_ik.','thigh_ik.')):p.bone.hide=True
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            s=area.spaces.active;s.overlay.show_overlays=True;s.overlay.show_extras=False
            s.overlay.show_relationship_lines=False;s.overlay.show_floor=False
            s.overlay.show_axis_x=False;s.overlay.show_axis_y=False
            s.region_3d.view_rotation=Quaternion((.7071068,.7071068,0,0))
            s.region_3d.view_perspective='ORTHO';s.region_3d.view_location=(0,0,.9);s.region_3d.view_distance=2.2
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
exec(compile(open(os.path.join(base,'rigging','final_validate.py')).read(),'final_validate.py','exec'))
