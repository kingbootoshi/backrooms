import * as THREE from "three";
import { CELL, Maze, SIZE, WALL_H } from "./maze";
import { carpetTexture, ceilingTexture, wallpaperTexture } from "./textures";

/**
 * Builds the entire level as a handful of draw calls:
 *   1 floor plane + 1 ceiling plane + 1 instanced wall mesh +
 *   1 instanced light-panel mesh + the exit group.
 * Dense exponential fog hides the far field, so overdraw stays tiny.
 */
export class World {
  readonly group = new THREE.Group();
  readonly exitPosition: THREE.Vector3;

  constructor(maze: Maze) {
    const worldSize = SIZE * CELL;

    // Floor
    const floorGeo = new THREE.PlaneGeometry(worldSize, worldSize);
    const floor = new THREE.Mesh(
      floorGeo,
      new THREE.MeshLambertMaterial({ map: carpetTexture(SIZE * 2) }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(worldSize / 2, 0, worldSize / 2);
    this.group.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(
      floorGeo,
      new THREE.MeshLambertMaterial({ map: ceilingTexture(SIZE * 2) }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(worldSize / 2, WALL_H, worldSize / 2);
    this.group.add(ceiling);

    // Walls - one InstancedMesh for every wall cell
    const wallCells: Array<{ x: number; z: number }> = [];
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (maze.isWall(x, z)) wallCells.push({ x, z });
      }
    }
    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const wallMat = new THREE.MeshLambertMaterial({ map: wallpaperTexture(2, 1.6) });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    const m = new THREE.Matrix4();
    wallCells.forEach((c, i) => {
      m.makeTranslation((c.x + 0.5) * CELL, WALL_H / 2, (c.z + 0.5) * CELL);
      walls.setMatrixAt(i, m);
    });
    walls.instanceMatrix.needsUpdate = true;
    this.group.add(walls);

    // Fluorescent panels - emissive-look quads on a sparse grid over floor cells
    const panelCells: Array<{ x: number; z: number }> = [];
    for (let z = 1; z < SIZE - 1; z++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if (!maze.isWall(x, z) && x % 3 === 1 && z % 3 === 1) panelCells.push({ x, z });
      }
    }
    const panelGeo = new THREE.PlaneGeometry(2.2, 1.1);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff7d8 });
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, panelCells.length);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    panelCells.forEach((c, i) => {
      m.makeTranslation((c.x + 0.5) * CELL, WALL_H - 0.02, (c.z + 0.5) * CELL).multiply(rot);
      panels.setMatrixAt(i, m);
    });
    panels.instanceMatrix.needsUpdate = true;
    this.group.add(panels);

    // The way out
    const exitCenter = maze.cellCenter(maze.exit);
    this.exitPosition = new THREE.Vector3(exitCenter.x, 0, exitCenter.z);
    this.group.add(this.buildExit(maze));
  }

  private buildExit(maze: Maze): THREE.Group {
    const g = new THREE.Group();
    const center = maze.cellCenter(maze.exit);
    const facing = maze.exitFacing;
    // Doorway flush against the neighboring wall face
    const wallOffset = CELL / 2 - 0.06;
    const doorX = center.x + facing.x * wallOffset;
    const doorZ = center.z + facing.z * wallOffset;
    const yaw = Math.atan2(-facing.x, -facing.z); // door front faces back into the room

    const door = new THREE.Group();
    door.position.set(doorX, 0, doorZ);
    door.rotation.y = yaw;

    // Pitch-black opening
    const opening = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }),
    );
    opening.position.y = 1.2;
    door.add(opening);

    // Frame
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.22), frameMat);
    frameTop.position.set(0, 2.5, 0.05);
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.22), frameMat);
    frameL.position.set(-0.95, 1.3, 0.05);
    const frameR = frameL.clone();
    frameR.position.x = 0.95;
    door.add(frameTop, frameL, frameR);

    // EXIT sign - the one cold-green beacon in a warm-yellow world
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.32),
      new THREE.MeshBasicMaterial({ color: 0x33ff77 }),
    );
    sign.position.set(0, 2.85, 0.1);
    door.add(sign);
    const signCanvas = document.createElement("canvas");
    signCanvas.width = 256;
    signCanvas.height = 96;
    const sctx = signCanvas.getContext("2d");
    if (sctx) {
      sctx.fillStyle = "#04130a";
      sctx.fillRect(0, 0, 256, 96);
      sctx.font = "bold 64px Arial";
      sctx.textAlign = "center";
      sctx.textBaseline = "middle";
      sctx.fillStyle = "#4dff8f";
      sctx.fillText("EXIT", 128, 52);
      const tex = new THREE.CanvasTexture(signCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      (sign.material as THREE.MeshBasicMaterial).map = tex;
      (sign.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    }

    // Green spill light - static, the only extra point light in the level
    const glow = new THREE.PointLight(0x2dff80, 2.2, 14, 1.6);
    glow.position.set(doorX - facing.x * 1.2, 2.2, doorZ - facing.z * 1.2);

    g.add(door, glow);
    return g;
  }
}
