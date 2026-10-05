import bpy, os, json, math
current={o.name:o for o in bpy.context.scene.objects if o.type in {'MESH','CAMERA','LIGHT'}}
body=current['OpenMarch_Body'];rig=bpy.data.objects['OpenMarch_Rig']
src=os.path.join(os.path.dirname(bpy.data.filepath),'openmarch-body-v3.blend')
names=[n for n,o in current.items() if o.type in {'CAMERA','LIGHT'}]+['OpenMarch_Body']
with bpy.data.libraries.load(src,link=False) as (available,loaded):
    loaded.objects=list(names)
original=dict(zip(names,loaded.objects))
base=original['OpenMarch_Body']
def geometry(m):
    return ([list(v.co) for v in m.data.vertices],[list(p.vertices) for p in m.data.polygons],
            [p.use_smooth for p in m.data.polygons],[p.material_index for p in m.data.polygons])
def material(m):
    def val(v):
        try:return list(v)
        except TypeError:return v
    return {'diffuse':list(m.diffuse_color),'nodes':[(n.bl_idname,[(s.name,val(s.default_value)) for s in n.inputs if hasattr(s,'default_value')]) for n in m.node_tree.nodes] if m.use_nodes else [],
        'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links] if m.use_nodes else []}
lights_cameras=True
for name in names[:-1]:
    a=current[name];b=original[name]
    lights_cameras &= tuple(a.location)==tuple(b.location) and tuple(a.rotation_euler)==tuple(b.rotation_euler) and tuple(a.scale)==tuple(b.scale)
    props=['energy','color','type','shape','size','size_y'] if a.type=='LIGHT' else ['lens','type','ortho_scale','sensor_width','sensor_height','shift_x','shift_y','clip_start','clip_end']
    for prop in props:
        if hasattr(a.data,prop):
            aa=getattr(a.data,prop);bb=getattr(b.data,prop)
            try:lights_cameras &= tuple(aa)==tuple(bb)
            except TypeError:lights_cameras &= aa==bb
deform={b.name for b in rig.data.bones if b.use_deform}
report={'geometry_topology_shading_unchanged':geometry(body)==geometry(base),
    'materials_unchanged':[material(m) for m in body.data.materials]==[material(m) for m in base.data.materials],
    'cameras_lights_unchanged':bool(lights_cameras),'vertices':len(body.data.vertices),'faces':len(body.data.polygons),
    'uv_layers':len(body.data.uv_layers),'shape_keys':bool(body.data.shape_keys),
    'deform_bones':len(deform),'vertex_groups':len(body.vertex_groups),
    'groups_exactly_deform_bones':set(g.name for g in body.vertex_groups)==deform,
    'unweighted_vertices':sum(not v.groups for v in body.data.vertices),
    'max_influences':max(len(v.groups) for v in body.data.vertices),
    'max_weight_sum_error':max(abs(1-sum(g.weight for g in v.groups)) for v in body.data.vertices),
    'armature_modifier_correct':len(body.modifiers)==1 and body.modifiers[0].type=='ARMATURE' and body.modifiers[0].object==rig,
    'deform_bones_protected':all(rig.data.bones[n].hide_select for n in deform),
    'actions':[{'name':a.name,'range':list(a.frame_range),'retained':a.use_fake_user} for a in bpy.data.actions if a.name in ['Rig_Test','Rig_IK_Check']],
    'active_action':rig.animation_data.action.name,'frame':bpy.context.scene.frame_current,
    'embedded_guide':bool(bpy.data.texts.get('OpenMarch_Rig_README'))}
print('FINAL_VALIDATION_CHECK '+json.dumps(report))
assert report['geometry_topology_shading_unchanged'] and report['materials_unchanged'] and report['cameras_lights_unchanged']
assert report['groups_exactly_deform_bones'] and report['unweighted_vertices']==0 and report['max_influences']<=4
assert report['armature_modifier_correct'] and report['deform_bones_protected'] and report['embedded_guide']
out=os.path.join(os.path.dirname(bpy.data.filepath),'rigging','final_validation.json')
open(out,'w').write(json.dumps(report,indent=2))
print('FINAL_VALIDATION '+json.dumps(report))
