import { boxGeom_create } from './boxGeom.js';
import { colors, defaultColors } from './boxColors.js';
import { align, $scale, $translate } from './boxTransforms.js';
import { component_create, entity_add } from './entity.js';
import { geom_merge } from './geom.js';
import { keys_create } from './keys.js';
import { light_create } from './directionalLight.js';
import { fbm3d } from './fbm.js';
import { material_create } from './material.js';
import { clamp } from './math.js';
import { mesh_create } from './mesh.js';
import { object3d_create, object3d_add, object3d_lookAt } from './object3d.js';
import {
  player_create,
  player_update,
  PMF_GRAPPLE_FLY,
  PMF_GRAPPLE_PULL,
  PMF_GRAPPLE,
  GRAPPLE_SPEED,
} from './player.js';
import {
  physics_add,
  physics_bodies,
  physics_update,
  get_physics_component,
  BODY_STATIC,
  BODY_DYNAMIC,
} from './physics.js';
import { ray_create, ray_intersectObjects } from './ray.js';
import {
  vec3_create,
  vec3_add,
  vec3_addScaledVector,
  vec3_applyQuaternion,
  vec3_cross,
  vec3_distanceTo,
  vec3_fromArray,
  vec3_length,
  vec3_multiplyScalar,
  vec3_normalize,
  vec3_set,
  vec3_subVectors,
} from './vec3.js';
import { compose } from './utils.js';

export var createMap = (gl, scene, camera) => {
  var fogColor = [0.8, 0.85, 1];
  gl.clearColor(...fogColor, 1);
  vec3_set(scene.fogColor, ...fogColor);
  scene.fogFar = 2048;

  var map = object3d_create();
  object3d_add(scene, map);

  var keys = keys_create();

  // Lights
  var ambient = vec3_create(0.3, 0.3, 0.3);

  var light0 = light_create(vec3_create(0.8, 0.8, 1));
  vec3_set(light0.position, 0, 64, 256);

  var light1 = light_create(vec3_create(0.5, 0.5, 0.6), 4);
  vec3_set(light1.position, 128, 512, -128);

  var directionalLights = [light0, light1];

  directionalLights.map(light => object3d_add(map, light));

  // Camera
  var cameraObject = object3d_create();
  object3d_add(cameraObject, camera);
  object3d_add(map, cameraObject);

  // Action
  var playerMesh = physics_add(
    mesh_create(boxGeom_create(30, 56, 30), material_create()),
    BODY_DYNAMIC,
  );
  playerMesh.position.y += 28;
  playerMesh.visible = false;
  object3d_add(map, playerMesh);

  var player = player_create(playerMesh, get_physics_component(playerMesh));
  player.scene = map;

  var GRAPPLE_OFFSET = vec3_create(8, -8, 0);
  var grappleStartDelta = vec3_create();
  var grapplePositionDelta = vec3_create();

  var rayGeometry = align('nz')(boxGeom_create(2, 1, 1));
  var rayMaterial = material_create();

  vec3_set(rayMaterial.color, 0.1, 0.1, 0.1);
  vec3_set(rayMaterial.emissive, 0.9, 0.9, 0.9);
  var rayMesh = mesh_create(rayGeometry, rayMaterial);
  rayMesh.visible = false;
  object3d_add(map, rayMesh);

  var pointGeometry = boxGeom_create(3, 3, 3);
  var pointMaterial = material_create();
  vec3_set(pointMaterial.emissive, 0.5, 1, 0.5);
  var pointMesh = mesh_create(pointGeometry, pointMaterial);
  pointMesh.visible = false;
  object3d_add(map, pointMesh);

  var grappleAmmo = 100;
  var grappleFireRate = grappleAmmo / 4;
  var grappleRegenRate = grappleAmmo / 8;
  var progressEl = document.querySelector('.p');
  progressEl.hidden = false;

  entity_add(
    map,
    component_create({
      update(component, dt) {
        var bodies = physics_bodies(map);
        physics_update(bodies);

        player.dt = dt;

        player.command.forward = 0;
        player.command.right = 0;
        player.command.up = 0;
        player.command.hook = 0;

        if (keys.KeyW || keys.ArrowUp) player.command.forward++;
        if (keys.KeyS || keys.ArrowDown) player.command.forward--;
        if (keys.KeyA || keys.ArrowLeft) player.command.right--;
        if (keys.KeyD || keys.ArrowRight) player.command.right++;
        if (keys.Space) player.command.up++;
        if (keys.ShiftLeft || keys.ShiftRight) player.command.hook++;

        var movespeed = 127;
        player.command.forward *= movespeed;
        player.command.right *= movespeed;
        player.command.up *= movespeed;

        vec3_applyQuaternion(
          vec3_set(player.viewForward, 0, 0, -1),
          camera.quaternion,
        );
        vec3_normalize(
          vec3_cross(vec3_set(player.viewRight, 0, -1, 0), player.viewForward),
        );

        player_update(player);
        Object.assign(cameraObject.position, playerMesh.position);

        // Grappling hook
        var ray = ray_create();
        Object.assign(ray.origin, playerMesh.position);
        vec3_set(ray.direction, 0, 0, -1);
        vec3_applyQuaternion(ray.direction, camera.quaternion);

        var isGrappling = player.movementFlags & PMF_GRAPPLE;

        if (player.command.hook) {
          // Hook fire.
          if (!isGrappling) {
            var intersections = ray_intersectObjects(
              ray,
              bodies
                .map(body => body.parent)
                .filter(object => object !== playerMesh),
            );
            if (intersections.length) {
              Object.assign(player.grapplePoint, intersections[0].point);
              Object.assign(pointMesh.position, playerMesh.position);
              vec3_add(
                pointMesh.position,
                vec3_applyQuaternion(
                  Object.assign(grappleStartDelta, GRAPPLE_OFFSET),
                  camera.quaternion,
                ),
              );
              player.movementFlags |= PMF_GRAPPLE_FLY;
            }
          }
        } else {
          // Hook free.
          player.movementFlags &= ~PMF_GRAPPLE;
        }

        // Hook think.
        isGrappling = player.movementFlags & PMF_GRAPPLE;
        rayMesh.visible = isGrappling;
        pointMesh.visible = isGrappling;
        if (isGrappling) {
          if (player.movementFlags & PMF_GRAPPLE_FLY) {
            // Hook move.
            vec3_subVectors(
              grapplePositionDelta,
              player.grapplePoint,
              pointMesh.position,
            );
            var grappleDeltaLength = Math.min(
              vec3_length(grapplePositionDelta),
              GRAPPLE_SPEED * dt,
            );
            vec3_normalize(grapplePositionDelta);
            vec3_addScaledVector(
              pointMesh.position,
              grapplePositionDelta,
              grappleDeltaLength,
            );

            // Hook connected.
            if (!grappleDeltaLength) {
              player.movementFlags &= ~PMF_GRAPPLE_FLY;
              player.movementFlags |= PMF_GRAPPLE_PULL;
            }
          }

          Object.assign(rayMesh.position, playerMesh.position);
          vec3_add(
            rayMesh.position,
            vec3_applyQuaternion(
              Object.assign(grappleStartDelta, GRAPPLE_OFFSET),
              camera.quaternion,
            ),
          );
          rayMesh.scale.z = vec3_distanceTo(
            rayMesh.position,
            pointMesh.position,
          );
          object3d_lookAt(rayMesh, pointMesh.position);
        }

        grappleAmmo += isGrappling
          ? -grappleFireRate * dt
          : grappleRegenRate * dt;
        if (grappleAmmo <= 0) {
          player.movementFlags &= ~PMF_GRAPPLE;
          keys.ShiftLeft = false;
          keys.ShiftRight = false;
        }
        grappleAmmo = clamp(grappleAmmo, 0, 100);

        progressEl.style.setProperty('--p-w', `${grappleAmmo}%`);
      },
    }),
  );

  var fbm = fbm3d();

  var perturbVertex = offset => {
    return vertex =>
      vec3_multiplyScalar(
        vertex,
        1 + fbm(vertex.x + offset, vertex.y + offset, vertex.z + offset),
      );
  };

  var createPlatformGeometry = (width, depth, topHeight, bottomHeight) => {
    var geom = geom_merge(
      compose(
        align('ny'),
        $scale({ py: [0.6, 1, 0.6] }),
      )(boxGeom_create(width, topHeight, depth)),
      compose(
        align('py'),
        $scale({ ny: [0.2, 1, 0.2] }),
        defaultColors([0.8, 0.8, 0.8]),
        colors({ ny: [0.3, 0.2, 0.2] }),
      )(boxGeom_create(width, bottomHeight, depth)),
    );

    geom.vertices.map(perturbVertex(width * Math.random()));
    return geom;
  };

  // Rocks
  [
    [
      geom_merge(
        compose(
          align('ny'),
          $scale({ nx_py: 0.8, px_py: [0.6, 0.6, 0.4], nx: 0.8 }),
          $translate({
            px_nz: { x: -8, z: -8 },
            px_pz: { z: -2 },
            nx_pz: { y: -4 },
          }),
        )(boxGeom_create(64, 12, 64)),
        compose(
          align('py'),
          $scale({ nx: 0.8, ny: [0.6, 1, 0.8] }),
          $translate({
            px_nz: { x: -8, z: -8 },
            px_pz: { z: -2 },
            nx_pz: { y: -4 },
          }),
          defaultColors([1, 1, 1]),
          colors({ ny: [0.2, 0.2, 0.2] }),
        )(boxGeom_create(64, 32, 64)),
      ),
      [64, 72, -256],
    ],
    [createPlatformGeometry(128, 128, 16, 32), [-64, 16, 320]],
    [createPlatformGeometry(128, 128, 16, 32), [-32, 48, 512]],
    [createPlatformGeometry(128, 128, 16, 32), [0, 80, 704]],
    [createPlatformGeometry(128, 128, 16, 32), [0, 120, 920]],
  ].map(([geom, position]) => {
    var material = material_create();
    material.shininess = 1;
    var mesh = physics_add(mesh_create(geom, material), BODY_STATIC);
    vec3_fromArray(mesh.position, position);
    object3d_add(map, mesh);
  });

  [
    // Floor
    [[512, 4, 512], [0, -2, 0]],
    [[32, 56, 1], [0, 28, -128]],
    [[32, 28, 1], [-64, 14, -128]],
    [[640, 8, 128], [-448, 28, 0]],
    [[384, 320, 512], [0, -136, -512]],
    [[64, 64, 64], [160, 32, 160]],
    [[512, 512, 512], [-480, 260, -512]],
    [[512, 512, 512], [480, 260, -1024]],
    [[512, 640, 512], [-480, 324, -1536]],
    [[768, 2048, 320], [384, 1028, -1920]],
    [[128, 8, 128], [260, 24, -192]],
    [[128, 8, 128], [292, 40, -320]],
    [[128, 8, 128], [324, 56, -448]],
  ].map(([dimensions, position]) => {
    var mesh = physics_add(
      mesh_create(boxGeom_create(...dimensions), material_create()),
      BODY_STATIC,
    );
    vec3_fromArray(mesh.position, position);
    object3d_add(map, mesh);
  });

  return {
    ambient,
    directional: directionalLights,
  };
};
