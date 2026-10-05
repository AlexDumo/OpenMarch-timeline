"""Continuous low-poly body study, modeled from reference silhouettes.

No imported meshes or dependencies. Units: metres; forward: -Y.
Run in Blender with runpy.run_path(PATH)['build']('standard').
CLI: blender --background scene.blend --python this.py -- --preset standard
The segmented marcher generator remains separate for historical reference.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
PRESETS = {'compact': (.92,.96,.98), 'standard': (1,1,1), 'tall_broad': (1.09,1.13,1.07)}


def build(preset='standard', triangles=950, eyes=True, save=False):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    c=bpy.data.collections.get('OpenMarch_Marcher')
    if c is None:
        c=bpy.data.collections.new('OpenMarch_Marcher'); bpy.context.scene.collection.children.link(c)
    for o in list(c.all_objects):
        if any(x != c for x in o.users_collection):
            raise RuntimeError('Shared object outside collection: '+o.name)
        bpy.data.objects.remove(o,do_unlink=True)
    h,w,d=PRESETS[preset]
    c['generator']='tools/blender/create_openmarch_body.py'
    c['stage']='continuous body study'; c['preset']=preset
    def material(name,color):
        mat=bpy.data.materials.get(name)
        if mat and any(mat==s.material for o in bpy.data.objects for s in o.material_slots):
            raise RuntimeError('Material used outside collection: '+name)
        mat=mat or bpy.data.materials.new(name)
        mat.use_nodes=True; mat.node_tree.nodes.clear()
        p=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled'); out=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        p.inputs['Base Color'].default_value=(*color,1)
        p.inputs['Roughness'].default_value=.85
        mat.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface'])
        mat.diffuse_color=(*color,1)
        return mat
    skin=material('Skin',(.13,.24,.63))
    white=material('Uniform_Secondary',(.93,.96,1))
    dark=material('Uniform_Primary',(.012,.019,.035))
    sources=[]
    def mesh(name,verts,faces,mat=skin,source=True):
        data=bpy.data.meshes.new(name)
        data.from_pydata([(v[0]*w,v[1]*d,v[2]*h) for v in verts],[],faces); data.update()
        o=bpy.data.objects.new(name,data); c.objects.link(o); data.materials.append(mat)
        if source: sources.append(o)
        return o
    def loft(name,rows,n=12):
        # Each row specifies centre and cross-section radii in the horizontal plane.
        verts=[(x+rx*math.cos(2*math.pi*j/n),y+ry*math.sin(2*math.pi*j/n),z)
               for x,y,z,rx,ry in rows for j in range(n)]
        faces=[tuple(reversed(range(n)))]
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(rows)-1) for j in range(n)]
        faces.append(tuple(range((len(rows)-1)*n,len(rows)*n)))
        return mesh(name,verts,faces)
    def ball(name,center,radii,mat=skin,source=True,n=12,rings=8):
        verts=[]
        for i in range(rings+1):
            a=-math.pi/2+math.pi*i/rings; rr=max(.01,math.cos(a))
            verts += [(center[0]+radii[0]*rr*math.cos(2*math.pi*j/n),center[1]+radii[1]*rr*math.sin(2*math.pi*j/n),center[2]+radii[2]*math.sin(a)) for j in range(n)]
        faces=[tuple(reversed(range(n)))]
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(rings) for j in range(n)]
        faces.append(tuple(range(rings*n,(rings+1)*n)))
        return mesh(name,verts,faces,mat,source)
    def limb(name,points,radii,n=12):
        points=[Vector(p) for p in points]; verts=[]
        for i,p in enumerate(points):
            direction=points[min(i+1,len(points)-1)]-points[max(0,i-1)]
            tangent=direction.normalized()
            axis_x=(Vector((1,0,0))-tangent*tangent.x).normalized()
            axis_y=tangent.cross(axis_x).normalized()
            rx,ry=radii[i]
            verts += [p+axis_x*(rx*math.cos(2*math.pi*j/n))+axis_y*(ry*math.sin(2*math.pi*j/n)) for j in range(n)]
        faces=[tuple(reversed(range(n)))]
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(points)-1) for j in range(n)]
        faces.append(tuple(range((len(points)-1)*n,len(points)*n)))
        return mesh(name,verts,faces)

    # One flowing torso/pelvis/neck/head silhouette; shoulders attach inside chest.
    loft('Torso',[(0,0,.96,.09,.074),(0,0,1.025,.139,.085),(0,.007,1.12,.124,.075),(0,.003,1.23,.115,.074),(0,0,1.355,.152,.092),(0,0,1.435,.17,.088),(0,0,1.475,.142,.075),(0,0,1.495,.083,.060)],16)
    loft('Neck_Head',[(0,0,1.455,.059,.051),(0,0,1.54,.048,.048),(0,-.003,1.592,.051,.051),(0,-.007,1.635,.064,.06),(0,-.008,1.70,.082,.073),(0,-.008,1.79,.086,.077),(0,-.006,1.841,.059,.057),(0,-.005,1.855,.023,.025)],12)
    for side,s in [('L',1),('R',-1)]:
        limb('Leg_'+side,[(s*.083,0,1.055),(s*.105,.005,.95),(s*.121,.007,.79),(s*.14,-.022,.583),(s*.151,-.008,.45),(s*.164,.012,.28),(s*.174,.017,.097),(s*.174,.005,.052)],[(.077,.076),(.079,.078),(.070,.065),(.049,.049),(.050,.049),(.037,.039),(.025,.029),(.026,.031)])
        # Small foot, continuous with the ankle, without shoe/sole segments.
        ball('Foot_'+side,(s*.174,-.055,.037),(.041,.109,.037),n=12)
        ball('Shoulder_'+side,(s*.17,0,1.429),(.073,.073,.08))
        limb('Arm_'+side,[(s*.173,0,1.446),(s*.226,0,1.355),(s*.293,-.017,1.211),(s*.316,-.027,1.164),(s*.333,-.058,1.09),(s*.357,-.094,.976)],[(.065,.063),(.059,.059),(.044,.044),(.040,.041),(.043,.039),(.027,.027)])
        limb('Hand_'+side,[(s*.357,-.094,.988),(s*.372,-.113,.94),(s*.379,-.116,.883)],[(.026,.026),(.036,.024),(.023,.019)])
        ball('Thumb_'+side,(s*.348,-.13,.945),(.02,.022,.034))

    for o in bpy.context.selected_objects: o.select_set(False)
    for o in sources: o.select_set(True)
    bpy.context.view_layer.objects.active=sources[0]
    bpy.ops.object.join(); body=bpy.context.object; body.name='OpenMarch_Body'
    # Weld the entire form volumetrically, then reduce to broad irregular facets.
    remesh=body.modifiers.new('Weld continuous body','REMESH'); remesh.mode='VOXEL'; remesh.voxel_size=.009*min(h,w,d); remesh.use_smooth_shade=False
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=body.modifiers.new('Relax junctions','SMOOTH'); smooth.factor=1.1; smooth.iterations=5
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    body.data.calc_loop_triangles()
    decimate=body.modifiers.new('Broad low-poly facets','DECIMATE'); decimate.ratio=min(1,triangles/len(body.data.loop_triangles)); decimate.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    # Ensure consistent outward normals after topology conversion.
    bm=bmesh.new(); bm.from_mesh(body.data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(body.data); bm.free()
    body.data.materials.clear(); body.data.materials.append(skin)
    for p in body.data.polygons: p.use_smooth=False
    body['design']='Continuous reference-inspired body, built from scratch'
    body['forward']='-Y'; body['preset']=preset; body['stage']='unrigged body study'
    if eyes:
        for side,s in [('L',1),('R',-1)]:
            eye=ball('Eye_'+side,(s*.037,-.077,1.759),(.024,.020,.025),white,False,12,8)
            pupil=ball('Pupil_'+side,(s*.037,-.095,1.759),(.0105,.0055,.012),dark,False,10,6)
            for ob in [eye,pupil]:
                for p in ob.data.polygons: p.use_smooth=True
                ob.parent=body
    setup_presentation(c,h)
    for o in bpy.context.selected_objects: o.select_set(False)
    bpy.context.view_layer.objects.active=body
    bpy.context.view_layer.update()
    if save: save_file()
    return body


def setup_presentation(c,height):
    scene=bpy.context.scene
    target=Vector((0,-.005,.965*height))
    data=bpy.data.cameras.new('Body_Preview_Camera'); camera=bpy.data.objects.new('Body_Preview_Camera',data); c.objects.link(camera)
    camera.location=(2.8,-6,2.1*height)
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO'; data.ortho_scale=2.22*height; scene.camera=camera
    for name,loc,power,size,color in [('Key',(-3,-4,5),400,4,(1,.91,.82)),('Fill',(4,-3,3),150,4,(.72,.83,1)),('Rim',(1,3,4),280,3,(.70,.82,1))]:
        ld=bpy.data.lights.new('Body_'+name,'AREA'); ld.energy=power; ld.size=size; ld.color=color
        light=bpy.data.objects.new(ld.name,ld); c.objects.link(light); light.location=loc
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    world=bpy.data.worlds.new('Body_Studio'); world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.065,.08,.105,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.5; scene.world=world
    scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.use_denoising=True
    scene.render.resolution_x=960; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
    scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(ROOT/'assets/previews/openmarch-body-v2-render.png')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                sp=area.spaces.active; sp.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
                sp.region_3d.view_location=target; sp.region_3d.view_distance=4.2*height; sp.region_3d.view_perspective='ORTHO'
                sp.lens=50; sp.shading.type='SOLID'; sp.shading.color_type='MATERIAL'; sp.shading.light='STUDIO'
                sp.shading.show_cavity=False; sp.shading.show_shadows=True; sp.overlay.show_overlays=False


def save_file():
    path=ROOT/'assets/blender/openmarch-body-v2.blend'; path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser(); parser.add_argument('--preset',choices=PRESETS,default='standard')
    opts=parser.parse_args(args); build(opts.preset,save=True)
