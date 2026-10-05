"""Original OpenMarch segmented marcher. Blender 4.5+/5.x, no dependencies.

Live: exec(compile(open(PATH).read(), PATH, 'exec')); build('standard')
CLI: blender --background scene.blend --python this.py -- --preset standard --save
Front is -Y, Z up, metres. Only objects in OpenMarch_Marcher are replaced.
Rigid segment weights are intentional; Plume_Removable is independently removable.
"""
import argparse
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector, Matrix, Quaternion

ROOT = Path(__file__).resolve().parents[2]
PRESETS = {
    'compact': dict(height=0.91, width=0.94, depth=0.96, head=1.035),
    'standard': dict(height=1.0, width=1.0, depth=1.0, head=1.0),
    'tall_broad': dict(height=1.09, width=1.15, depth=1.08, head=1.0),
}
COLLECTION = 'OpenMarch_Marcher'
PALETTE = {
    'Skin': ((0.53, 0.29, 0.16, 1), .82, 0),
    'Uniform_Primary': ((.018, .065, .125, 1), .74, 0),
    'Uniform_Secondary': ((.82, .86, .78, 1), .72, 0),
    'Metal_Trim': ((.67, .43, .12, 1), .38, .65),
    'Plume': ((.025, .42, .43, 1), .85, 0),
    'Instrument': ((.77, .50, .17, 1), .29, .78),
}


class Marcher:
    def __init__(self, preset):
        self.p = PRESETS[preset]
        self.c = bpy.data.collections.get(COLLECTION)
        if self.c is None:
            self.c = bpy.data.collections.new(COLLECTION)
            bpy.context.scene.collection.children.link(self.c)
        for o in list(self.c.all_objects):
            if any(c != self.c for c in o.users_collection):
                raise RuntimeError('Refusing to replace an object shared outside marcher collection')
            bpy.data.objects.remove(o, do_unlink=True)
        self.c['generator'] = 'tools/blender/create_openmarch_marcher.py'
        self.c['preset'] = preset
        self.meshes = []
        self.mats = {}
        for name, (color, roughness, metallic) in PALETTE.items():
            mat = bpy.data.materials.get(name)
            if mat is not None and mat.users:
                # Never mutate a material used by another collection.
                if any(mat == slot.material for o in bpy.data.objects for slot in o.material_slots):
                    raise RuntimeError('Material name already in use: ' + name)
            mat = mat or bpy.data.materials.new(name)
            mat.use_nodes = True
            mat.node_tree.nodes.clear()
            bsdf = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
            out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Roughness'].default_value = roughness
            bsdf.inputs['Metallic'].default_value = metallic
            mat.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
            mat.diffuse_color = color
            self.mats[name] = mat

    def v(self, p):
        return Vector((p[0]*self.p['width'], p[1]*self.p['depth'], p[2]*self.p['height']))

    def mesh(self, name, verts, faces, mat, bone, smooth=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata([self.v(v) for v in verts], [], faces)
        data.update()
        o = bpy.data.objects.new(name, data)
        self.c.objects.link(o)
        data.materials.append(self.mats[mat])
        for p in data.polygons:
            p.use_smooth = smooth
        o['bone'] = bone
        self.meshes.append(o)
        return o

    def rings(self, name, center, profile, mat, bone, n=12, smooth=False):
        verts = [(center[0]+rx*math.cos(2*math.pi*j/n), center[1]+ry*math.sin(2*math.pi*j/n), center[2]+z)
                 for z, rx, ry in profile for j in range(n)]
        faces = [tuple(reversed(range(n)))]
        for i in range(len(profile)-1):
            for j in range(n):
                a=i*n+j; b=i*n+(j+1)%n
                faces.append((a,b,b+n,a+n))
        faces.append(tuple(range((len(profile)-1)*n,len(profile)*n)))
        return self.mesh(name,verts,faces,mat,bone,smooth)

    def ellipsoid(self,name,center,scale,mat,bone,n=12):
        profile=[]
        for i in range(9):
            a=-math.pi/2+math.pi*i/8
            r=max(.025,math.cos(a))
            profile.append((scale[2]*math.sin(a),scale[0]*r,scale[1]*r))
        return self.rings(name,center,profile,mat,bone,n,True)

    def segment(self,name,a,b,r1,r2,mat,bone,n=12):
        a,b=Vector(a),Vector(b); delta=b-a
        q=Vector((0,0,1)).rotation_difference(delta.normalized())
        length=delta.length
        profile=[(0,r1*.66),(.025,r1),(length-.025,r2),(length,r2*.65)]
        verts=[a+q@Vector((r*math.cos(j*2*math.pi/n),r*math.sin(j*2*math.pi/n),z)) for z,r in profile for j in range(n)]
        faces=[tuple(reversed(range(n)))]
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(3) for j in range(n)]
        faces.append(tuple(range(3*n,4*n)))
        return self.mesh(name,verts,faces,mat,bone,True)

    def tube(self,name,points,r,mat,bone,n=8):
        points=[Vector(p) for p in points]; verts=[]
        for i,p in enumerate(points):
            d=points[min(i+1,len(points)-1)]-points[max(0,i-1)]
            q=Vector((0,0,1)).rotation_difference(d.normalized())
            verts += [p+q@Vector((r*math.cos(j*2*math.pi/n),r*math.sin(j*2*math.pi/n),0)) for j in range(n)]
        faces=[tuple(reversed(range(n)))]
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(points)-1) for j in range(n)]
        faces.append(tuple(range((len(points)-1)*n,len(points)*n)))
        return self.mesh(name,verts,faces,mat,bone,True)

    def base(self):
        self.joints={}
        self.rings('Body_Torso_Jacket',(0,0,0),[(1.00,.145,.093),(1.025,.16,.103),(1.13,.165,.11),(1.37,.22,.128),(1.445,.228,.113),(1.475,.18,.09)],'Uniform_Primary','spine',16,True)
        self.ellipsoid('Body_Pelvis_Bibbers',(0,0,1.005),(.157,.104,.13),'Uniform_Primary','pelvis')
        self.segment('Body_Neck',(0,0,1.45),(0,0,1.585),.056,.053,'Skin','neck')
        h=self.p['head']
        self.ellipsoid('Body_Head',(0,-.004,1.681),(.094*h,.091*h,.127*h),'Skin','head',16)
        for side,s in [('L',1),('R',-1)]:
            hip=(s*.098,0,1.005); knee=(s*.112,-.012,.555); ankle=(s*.12,0,.12)
            shoulder=(s*.234,0,1.445); elbow=(s*.294,-.055,1.169); wrist=(s*.095,-.322,1.300)
            hand=(s*.057,-.363,1.325)
            self.joints[side]=(hip,knee,ankle,shoulder,elbow,wrist,hand)
            self.segment('Body_UpperLeg_'+side,hip,knee,.089,.066,'Uniform_Primary','thigh.'+side)
            self.ellipsoid('Knee_'+side,knee,(.063,.063,.061),'Uniform_Primary','shin.'+side)
            self.segment('Body_LowerLeg_'+side,knee,ankle,.065,.046,'Uniform_Primary','shin.'+side)
            self.ellipsoid('Shoe_'+side,(s*.12,-.067,.066),(.062,.139,.066),'Uniform_Primary','foot.'+side)
            self.ellipsoid('Sole_'+side,(s*.12,-.07,.024),(.064,.138,.025),'Uniform_Primary','foot.'+side)
            self.ellipsoid('Shoulder_'+side,shoulder,(.071,.078,.081),'Uniform_Primary','upper_arm.'+side)
            self.segment('Body_UpperArm_'+side,shoulder,elbow,.073,.053,'Uniform_Primary','upper_arm.'+side)
            self.ellipsoid('Elbow_'+side,elbow,(.053,.054,.054),'Uniform_Primary','forearm.'+side)
            self.segment('Body_LowerArm_'+side,elbow,wrist,.056,.039,'Uniform_Primary','forearm.'+side)
            self.segment('Glove_Cuff_'+side,Vector(wrist).lerp(Vector(elbow),.16),wrist,.045,.043,'Uniform_Secondary','forearm.'+side)
            self.segment('Hand_Glove_'+side,wrist,hand,.043,.040,'Uniform_Secondary','hand.'+side)
            self.ellipsoid('Thumb_'+side,(s*.026,-.373,1.306),(.025,.028,.037),'Uniform_Secondary','hand.'+side)

    def uniform(self):
        self.rings('Jacket_Collar',(0,0,1.483),[(-.018,.073,.067),(.035,.069,.064)],'Uniform_Primary','neck',16)
        self.rings('Collar_Piping',(0,0,1.512),[(0,.071,.066),(.009,.071,.066)],'Metal_Trim','neck',16)
        self.rings('Waist_Belt',(0,0,1.064),[(-.021,.163,.109),(.021,.166,.112)],'Uniform_Secondary','spine',16)
        # Geometric chest chevron sits proud of the jacket surface.
        for s in [-1,1]:
            self.mesh('Chest_Chevron_'+str(s),[(s*.193,-.108,1.421),(0,-.135,1.293),(0,-.137,1.249),(s*.193,-.112,1.377)],[(0,1,2,3)],'Uniform_Secondary','spine')
            self.tube('Chevron_Trim_'+str(s),[(s*.192,-.114,1.427),(0,-.141,1.299)],.005,'Metal_Trim','spine')
        for z in [1.14,1.20,1.26]:
            self.ellipsoid('Jacket_Button_'+str(z),(0,-.118,z),(.013,.008,.013),'Metal_Trim','spine',8)
        self.ellipsoid('Belt_Clasp',(0,-.117,1.064),(.027,.010,.023),'Metal_Trim','spine',8)
        for side,s in [('L',1),('R',-1)]:
            self.ellipsoid('Epaulette_'+side,(s*.234,0,1.498),(.081,.074,.018),'Metal_Trim','upper_arm.'+side)
            hip,knee,ankle,*_=self.joints[side]
            self.tube('Trouser_Stripe_Upper_'+side,[(s*.177,-.015,.986),(s*.17,-.025,.78),(s*.172,-.023,.559)],.009,'Uniform_Secondary','thigh.'+side)
            self.tube('Trouser_Stripe_Lower_'+side,[(s*.173,-.012,.54),(s*.171,-.001,.33),(s*.163,0,.15)],.008,'Uniform_Secondary','shin.'+side)
        self.rings('Shako',(0,.006,1.794),[(0,.102,.099),(.025,.11,.105),(.184,.119,.108),(.201,.107,.101)],'Uniform_Primary','head',16)
        self.rings('Shako_Lower_Band',(0,.006,1.815),[(-.012,.111,.106),(.008,.112,.107)],'Metal_Trim','head',16)
        self.rings('Shako_Crown_Trim',(0,.006,1.98),[(0,.12,.109),(.011,.12,.109)],'Uniform_Secondary','head',16)
        self.ellipsoid('Shako_Visor',(0,-.095,1.811),(.111,.082,.014),'Uniform_Primary','head',16)
        self.ellipsoid('Shako_Badge',(0,-.104,1.909),(.028,.012,.045),'Metal_Trim','head',8)
        self.tube('Shako_Chin_Cord',[(-.093,-.047,1.808),(-.071,-.087,1.753),(0,-.095,1.737),(.071,-.087,1.753),(.093,-.047,1.808)],.006,'Metal_Trim','head')
        self.rings('Plume_Socket',(0,.006,1.995),[(0,.024,.024),(.039,.023,.023)],'Metal_Trim','head')
        plume=self.rings('Plume_Removable',(0,.015,2.018),[(0,.02,.023),(.035,.043,.040),(.105,.062,.048),(.181,.049,.039),(.225,.025,.024),(.246,.004,.004)],'Plume','head',10)
        plume['removable']=True

    def instrument(self):
        # Compact trumpet in vertical carry. Hollow flared bell, tubing and 3 valves.
        self.tube('Trumpet_Main_Tube',[(.048,-.390,1.51),(.048,-.390,1.25),(.032,-.390,1.213),(-.005,-.390,1.2),(-.060,-.390,1.213),(-.076,-.390,1.25),(-.076,-.390,1.48)],.014,'Instrument','instrument')
        self.tube('Trumpet_Leadpipe',[(-.076,-.39,1.48),(-.081,-.415,1.495),(-.088,-.432,1.49),(-.088,-.442,1.20)],.010,'Instrument','instrument')
        self.segment('Trumpet_Mouthpiece',(-.088,-.442,1.20),(-.088,-.442,1.18),.021,.018,'Instrument','instrument')
        for i in range(3):
            z=1.30+i*.047
            self.segment('Trumpet_Valve_'+str(i),(-.053,-.405,z),(.015,-.405,z),.020,.020,'Instrument','instrument',10)
            self.segment('Trumpet_Valve_Stem_'+str(i),(.012,-.405,z),(.032,-.405,z),.007,.007,'Instrument','instrument',8)
            self.ellipsoid('Trumpet_Valve_Button_'+str(i),(.034,-.405,z),(.007,.023,.018),'Instrument','instrument',10)
            self.tube('Trumpet_Valve_Loop_'+str(i),[(-.044,-.400,z),(-.055,-.440,z),(-.030,-.466,z),(-.008,-.443,z),(-.008,-.410,z)],.008,'Instrument','instrument')
        # Outer surface then rolled rim and inside taper. No filled cap across bell mouth.
        self.rings('Trumpet_Hollow_Bell',(.048,-.390,0),[(1.46,.014,.014),(1.52,.017,.017),(1.57,.027,.027),(1.612,.047,.047),(1.645,.080,.080),(1.651,.085,.085),(1.658,.083,.083),(1.652,.077,.077),(1.623,.045,.045),(1.583,.024,.024),(1.53,.012,.012)],'Instrument','instrument',20,True)

    def rig(self):
        data=bpy.data.armatures.new('OpenMarch_Skeleton')
        rig=bpy.data.objects.new('OpenMarch_Rig',data); self.c.objects.link(rig)
        self.armature=rig
        bpy.context.view_layer.objects.active=rig; rig.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        def bone(name,a,b,parent=None):
            eb=data.edit_bones.new(name); eb.head=self.v(a); eb.tail=self.v(b)
            if parent: eb.parent=data.edit_bones[parent]
        bone('root',(0,0,0),(0,0,.18))
        bone('pelvis',(0,0,.97),(0,0,1.09),'root')
        bone('spine',(0,0,1.09),(0,0,1.46),'pelvis')
        bone('neck',(0,0,1.46),(0,0,1.575),'spine')
        bone('head',(0,0,1.575),(0,0,1.80),'neck')
        for side in ['L','R']:
            hip,knee,ankle,shoulder,elbow,wrist,hand=self.joints[side]
            bone('clavicle.'+side,(0,0,1.445),shoulder,'spine')
            bone('upper_arm.'+side,shoulder,elbow,'clavicle.'+side)
            bone('forearm.'+side,elbow,wrist,'upper_arm.'+side)
            bone('hand.'+side,wrist,hand,'forearm.'+side)
            bone('thigh.'+side,hip,knee,'pelvis')
            bone('shin.'+side,knee,ankle,'thigh.'+side)
            bone('foot.'+side,ankle,(ankle[0],-.18,.065),'shin.'+side)
        bone('instrument',(.048,-.390,1.30),(.048,-.390,1.65),'hand.L')
        bpy.ops.object.mode_set(mode='OBJECT')
        for o in self.meshes:
            group=o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))),1,'REPLACE')
            mod=o.modifiers.new('OpenMarch_Skin','ARMATURE'); mod.object=rig
            o.parent=rig
        rig.show_in_front=True; data.display_type='STICK'
        rig['forward']='-Y'; rig['units']='metres'; rig['preset']=self.c['preset']
        for pb in rig.pose.bones: pb.rotation_mode='QUATERNION'
        return rig

    def animations(self):
        rig=self.armature; rig.animation_data_create()
        for a in list(bpy.data.actions):
            if a.get('openmarch_generated') and a.users<=1: bpy.data.actions.remove(a)
        def reset():
            for b in rig.pose.bones:
                b.location=(0,0,0); b.rotation_quaternion=(1,0,0,0); b.scale=(1,1,1)
        def rotate(name, axis, angle):
            rig.pose.bones[name].rotation_quaternion=Quaternion(axis,math.radians(angle))
        def arms_down():
            # Derive local rotations from desired global segment directions.
            for side,s in [('L',1),('R',-1)]:
                for name,target in [('upper_arm.'+side,(s*.035,0,-1)),('forearm.'+side,(0,-.06,-1)),('hand.'+side,(0,-.15,-1))]:
                    pb=rig.pose.bones[name]
                    rest=pb.bone.matrix_local.to_quaternion()
                    world=rest @ Vector((0,1,0))
                    wanted=world.rotation_difference(Vector(target).normalized()) @ rest
                    parent=pb.parent.matrix.to_quaternion()
                    parent_rest=pb.parent.bone.matrix_local.to_quaternion()
                    pb.rotation_quaternion=(parent @ parent_rest.inverted() @ rest).inverted() @ wanted
                    bpy.context.view_layer.update()
        for name,length in [('Attention',48),('March',48),('HornCarry',48)]:
            action=bpy.data.actions.new(name); action['openmarch_generated']=True; action.use_fake_user=True
            rig.animation_data.action=action
            for frame in range(1,length+2,3):
                reset()
                t=(frame-1)/length; phase=2*math.pi*t
                if name=='Attention': arms_down()
                elif name=='March':
                    for side,offset in [('L',0),('R',math.pi)]:
                        ph=phase+offset
                        rotate('thigh.'+side,(1,0,0),18*math.sin(ph))
                        rotate('shin.'+side,(1,0,0),-max(0,math.sin(ph))*24)
                        rotate('foot.'+side,(1,0,0),5*math.sin(ph))
                    rig.pose.bones['root'].location.z=.009*(1-math.cos(2*phase))
                for b in rig.pose.bones:
                    b.keyframe_insert('location',frame=frame,group=b.name)
                    b.keyframe_insert('rotation_quaternion',frame=frame,group=b.name)
            # Named NLA tracks retain actions for reuse. Muted to allow direct action preview.
            track=rig.animation_data.nla_tracks.new(); track.name=name
            strip=track.strips.new(name,1,action); track.mute=True
        rig.animation_data.action=bpy.data.actions['HornCarry']
        bpy.context.scene.render.fps=24; bpy.context.scene.frame_start=1; bpy.context.scene.frame_end=49
        bpy.context.scene.frame_set(1)

    def presentation(self):
        scene=bpy.context.scene
        camera_data=bpy.data.cameras.new('OpenMarch_Preview_Camera')
        camera=bpy.data.objects.new('OpenMarch_Preview_Camera',camera_data); self.c.objects.link(camera)
        target=self.v((0,-.03,1.13)); camera.location=self.v((3.15,-5.6,2.65))
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        camera_data.type='ORTHO'; camera_data.ortho_scale=2.85*self.p['height']; scene.camera=camera
        for name,loc,power,size,color in [('Key',(-3,-4,6),450,4,(1,.89,.77)),('Fill',(4,-2,3),220,3,(.72,.86,1)),('Rim',(0,3,4),380,3,(.72,1,1))]:
            ld=bpy.data.lights.new('OpenMarch_'+name,'AREA'); ld.energy=power; ld.shape='DISK'; ld.size=size; ld.color=color
            light=bpy.data.objects.new(ld.name,ld); self.c.objects.link(light); light.location=loc
            light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
        # Separate world datablock leaves the previous world untouched.
        world=bpy.data.worlds.new('OpenMarch_Preview_World'); world.use_nodes=True
        world.node_tree.nodes['Background'].inputs[0].default_value=(.055,.072,.09,1)
        world.node_tree.nodes['Background'].inputs[1].default_value=.45; scene.world=world
        scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.use_denoising=True
        scene.render.resolution_x=1100; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
        scene.view_settings.view_transform='AgX'
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type=='VIEW_3D':
                    space=area.spaces.active; space.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
                    space.region_3d.view_distance=3.4*self.p['height']; space.region_3d.view_location=target
                    space.region_3d.view_perspective='ORTHO'
                    space.shading.type='SOLID'; space.shading.color_type='MATERIAL'; space.shading.light='STUDIO'
                    space.shading.show_shadows=True; space.shading.show_cavity=True
                    space.overlay.show_overlays=False
        for o in bpy.context.selected_objects: o.select_set(False)


def build(preset='standard', stage='complete'):
    if bpy.context.object and bpy.context.object.mode!='OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
    m=Marcher(preset); m.base()
    if stage!='base': m.uniform(); m.instrument(); m.rig()
    if stage=='complete': m.animations()
    m.presentation(); bpy.context.view_layer.update()
    return m


def save():
    path=ROOT/'assets/blender/openmarch-marcher.blend'; path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser(); parser.add_argument('--preset',choices=PRESETS,default='standard'); parser.add_argument('--save',action='store_true')
    opts=parser.parse_args(args); build(opts.preset)
    if opts.save: save()
