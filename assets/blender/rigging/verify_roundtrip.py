import bpy, json, os
from mathutils import Vector
base=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results=[]
for suffix,samples in [('Rig_Test_Baked',os.path.join(base,'rigging','Rig_Test_samples.json')),('Rig_IK_Check_Baked',os.path.join(base,'rigging','Rig_IK_Check_samples.json'))]:
    expected=json.load(open(samples))
    for ext in ['glb','fbx']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps=24
        path=os.path.join(base,'exports','OpenMarch_'+suffix+'.'+ext)
        if ext=='glb':bpy.ops.import_scene.gltf(filepath=path)
        else:bpy.ops.import_scene.fbx(filepath=path)
        mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
        if ext=='fbx':
            bpy.context.view_layer.objects.active=rig
            bpy.ops.object.mode_set(mode='EDIT')
            for bone in rig.data.edit_bones:bone.use_connect=False
            bpy.ops.object.mode_set(mode='OBJECT')
        act=rig.animation_data.action
        if act is None:
            tracks=rig.animation_data.nla_tracks
            act=tracks[0].strips[0].action
        original=expected['poses'][0]['vertices']
        mapping=[]
        for v in mesh.data.vertices:
            co=mesh.matrix_world @ v.co
            mapping.append(min(range(len(original)),key=lambda i:(co-Vector(original[i])).length_squared))
        err=0.;frame_errors=[]
        for sample in expected['poses']:
            frame=sample['frame']-1+int(act.frame_range[0])
            bpy.context.scene.frame_set(frame)
            ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            frame_err=max((ev.matrix_world@v.co-Vector(sample['vertices'][idx])).length for v,idx in zip(ev.data.vertices,mapping))
            frame_errors.append((frame,frame_err));err=max(err,frame_err)
        record={'file':os.path.basename(path),'bones':len(rig.data.bones),'faces':len(mesh.data.polygons),
            'action':act.name,'frames':list(act.frame_range),'sampled_vertex_error':err,'frame_errors':frame_errors}
        results.append(record)
        print('ROUNDTRIP_CLIP '+str(record))
        if err>.00015:raise RuntimeError('Roundtrip mismatch: '+str(record))
open(os.path.join(base,'exports','roundtrip_validation.json'),'w').write(json.dumps(results,indent=2))
print('ROUNDTRIP_RESULT '+json.dumps(results))
