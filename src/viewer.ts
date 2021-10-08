/**
 @author VIM / https://vimaec.com
*/

import * as THREE from 'three'
import deepmerge from 'deepmerge'
import { VimScene } from './vim'
import { ViewerSettings } from './viewer_settings'
import { ViewerCamera, direction } from './viewer_camera'
import { ViewerGui } from './viewer_gui'
import { loadAny } from './viewer_loader'
import Stats from 'stats.js'
import { BufferGeometry } from 'three'

/*
Vim Viewer
Copyright VIMaec LLC, 2020
Licensed under the terms of the MIT License
*/

export class Viewer {
  canvas: HTMLCanvasElement | undefined = undefined
  logo: HTMLImageElement | undefined = undefined
  link: HTMLAnchorElement | undefined = undefined
  favicon: HTMLImageElement | undefined = undefined

  stats: any
  settings: any
  camera: THREE.PerspectiveCamera // PerspectiveCamera;
  renderer: THREE.WebGLRenderer // THREE.WebGLRenderer
  scene: THREE.Scene // THREE.Scene
  meshes = []

  plane: THREE.Mesh // THREE.Mesh
  sunlight: THREE.HemisphereLight // THREE.HemisphereLight
  light1: THREE.DirectionalLight // THREE.DirectionalLight
  light2: THREE.DirectionalLight // THREE.DirectionalLight
  material: THREE.MeshPhongMaterial // THREE.MeshPhongMaterial
  removeListeners: Function

  // eslint-disable-next-line no-use-before-define
  selection: Selection
  cameraController: ViewerCamera
  // eslint-disable-next-line no-use-before-define
  controls: ViewerInput
  vimScene: VimScene
  boundingSphere: THREE.Sphere

  constructor () {
    this.canvas = undefined
  }

  view (options: Record<string, unknown>) {
    this.settings = deepmerge(ViewerSettings.default, options, undefined)

    this.prepareDocument()

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: this.canvas
    })
    this.renderer.setPixelRatio(window.devicePixelRatio)

    // Create the camera and size everything appropriately
    this.camera = new THREE.PerspectiveCamera()
    this.cameraController = new ViewerCamera(this.camera, this.settings)
    this.resizeCanvas(true)

    // Create scene object
    this.scene = new THREE.Scene()

    if (this.settings.showGui) {
      // Create a new DAT.gui controller
      ViewerGui.bind(this.settings, (settings) => {
        this.settings = settings
        this.updateScene()
      })
    }

    // Ground
    this.plane = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(1000, 1000),
      new THREE.MeshPhongMaterial()
    )
    this.plane.rotation.x = -Math.PI / 2
    this.scene.add(this.plane)

    // Lights
    this.sunlight = new THREE.HemisphereLight()
    this.light1 = new THREE.DirectionalLight()
    this.light2 = new THREE.DirectionalLight()

    this.scene.add(this.sunlight)
    this.scene.add(this.light1)
    this.scene.add(this.light2)

    // Material
    this.material = new THREE.MeshPhongMaterial({
      color: 0x999999,
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
      shininess: 70
    })

    // Initial scene update: happens if controls change
    this.updateScene()

    // Add Stats display
    if (this.settings.showStats) {
      this.stats = new Stats()
      this.stats.dom.style.top = '84px'
      this.stats.dom.style.left = '16px'
      document.body.appendChild(this.stats.dom)
    }

    // Input and Selection
    this.controls = new ViewerInput(
      this.canvas,
      this.settings,
      this.cameraController
    )
    this.controls.register()
    this.controls.viewer = this
    this.selection = new Selection(this)

    // Add all of the appropriate mouse, touch-pad, and keyboard listeners
    // Load Vim
    loadAny(this.settings.url, this.loadInScene.bind(this))

    // Start Loop
    this.animate()
  }

  prepareDocument () {
    // Get or Add Canvas
    let canvas = document.getElementById(this.settings.canvasId)

    if (!canvas) {
      canvas = document.createElement('canvas')
      document.body.appendChild(canvas)
    }
    this.canvas = canvas as HTMLCanvasElement

    // Add Vim logo
    this.logo = document.createElement('img')
    this.logo.src = 'logo.png'
    this.logo.style.position = 'fixed'
    this.logo.style.top = '16px'
    this.logo.style.left = '16px'
    this.logo.height = 48
    this.logo.width = 128

    // Add logo as link
    this.link = document.createElement('a')
    this.link.href = 'https://vimaec.com'
    this.link.appendChild(this.logo)
    document.body.prepend(this.link)

    // Set Favicon
    this.favicon = document.createElement('img')
    this.favicon.setAttribute('href', 'favicon.ico')
    document.head.appendChild(this.favicon)
  }

  loadInScene (
    result:
      | VimScene
      | THREE.Scene
      | THREE.Group
      | THREE.Object3D
      | THREE.BufferGeometry
  ) {
    if (result instanceof VimScene) {
      this.onVimLoaded(result)
      return
    }

    if (result instanceof THREE.Scene) {
      result.traverse((obj) => {
        if (obj instanceof THREE.Mesh) this.addToScene(obj)
      })
    } else if (result instanceof THREE.BufferGeometry) {
      result.computeVertexNormals()
      this.addToScene(new THREE.Mesh(result))
    } else if (
      result instanceof THREE.Group ||
      result instanceof THREE.Object3D
    ) {
      this.addToScene(result)
    }
    this.boundingSphere = Viewer.computeBoundingSphere(this.scene)
    this.boundingSphere.applyMatrix4(this.getViewMatrix())
    this.focusModel()
  }

  onVimLoaded (vim: VimScene) {
    this.vimScene = vim

    for (let i = 0; i < vim.meshes.length; ++i) {
      this.addToScene(vim.meshes[i])
    }

    this.boundingSphere = vim.boundingSphere.clone()
    this.boundingSphere.applyMatrix4(this.getViewMatrix())
    this.focusModel()
  }

  addToScene (object: THREE.Object3D) {
    this.scene.add(object)
    this.meshes.push(object)
  }

  static computeBoundingSphere (scene: THREE.Scene): THREE.Sphere {
    let sphere = new THREE.Sphere()

    const grow = (geometry: BufferGeometry, matrix: THREE.Matrix4) => {
      const clone = geometry.clone()
      clone.applyMatrix4(matrix)
      clone.computeBoundingSphere()
      sphere = sphere.union(clone.boundingSphere)
    }
    const matrix = new THREE.Matrix4()
    scene.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, matrix)
          grow(obj.geometry, matrix)
        }
      } else if (obj instanceof THREE.Mesh) {
        grow(obj.geometry, obj.matrix)
      }
    })

    return sphere
  }

  // Calls render, and asks the framework to prepare the next frame
  animate () {
    requestAnimationFrame(() => this.animate())
    this.resizeCanvas()
    this.updateObjects()
    this.renderer.render(this.scene, this.camera)
    if (this.stats) {
      this.stats.update()
    }
  }

  updateObjects () {
    for (let i = 0; i < this.meshes.length; i++) {
      this.applyViewMatrix(this.meshes[i])
    }
  }

  applyViewMatrix (mesh) {
    const matrix = this.getViewMatrix()
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(matrix)
  }

  // TODO Not create this everytime, Not apply this every time either.
  getViewMatrix () {
    const pos = this.settings.object.position
    const rot = toQuaternion(this.settings.object.rotation)
    const scl = scalarToVec(0.1)
    const matrix = new THREE.Matrix4().compose(pos, rot, scl)
    return matrix
  }

  highlight (geometry): Function {
    const wireframe = new THREE.WireframeGeometry(geometry)
    const material = new THREE.LineBasicMaterial({
      depthTest: false,
      opacity: 0.5,
      color: new THREE.Color(0x0000ff),
      transparent: true
    })
    const line = new THREE.LineSegments(wireframe, material)

    this.scene.add(line)

    // returns disposer
    return () => {
      this.scene.remove(line)
      wireframe.dispose()
      material.dispose()
    }
  }

  createWorldGeometry (mesh: THREE.Mesh, index: number) {
    const geometry = mesh.geometry.clone()

    let matrix = new THREE.Matrix4()
    if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(index, matrix)
    else matrix.copy(mesh.matrix)
    matrix = this.getViewMatrix().multiply(matrix)
    geometry.applyMatrix4(matrix)

    return geometry
  }

  getNodeIndex (mesh: THREE.Mesh, instance: number): number | null {
    const indices = mesh.userData.instanceIndices as number[]

    if (!indices) {
      console.log('Error: Attempting to get node index of a non-vim object')
      return null
    }

    if (indices.length <= instance) {
      console.log('Error: Attempting to get node index out of range')
      return null
    }

    return indices[instance]
  }

  select (mesh: THREE.Mesh, index: number) {
    this.selection.select(mesh, index)
    const nodeIndex = this.getNodeIndex(mesh, index)
    if (nodeIndex) {
      const elementName = this.getElementNameFromNodeIndex(nodeIndex)
      console.log('Selected Element: ' + elementName)
    }
  }

  clearSelection () {
    this.selection.reset()
    console.log('Cleared Selection')
  }

  focusSelection () {
    if (this.selection.hasSelection()) {
      this.cameraController.lookAtSphere(this.selection.boundingSphere)
    } else this.focusModel()
  }

  focusModel () {
    this.cameraController.lookAtSphere(this.boundingSphere)
  }

  resizeCanvas (force: boolean = false) {
    if (!this.settings.autoResize && !force) {
      return
    }

    const w = window.innerWidth / window.devicePixelRatio
    const h = window.innerHeight / window.devicePixelRatio
    this.renderer.setSize(w, h, false)
    this.camera.aspect = this.canvas.width / this.canvas.height
    this.camera.updateProjectionMatrix()
  }

  // Called every frame in case settings are updated
  updateScene () {
    this.scene.background = toColor(this.settings.background.color)
    this.plane.visible = this.settings.plane.show
    this.updateMaterial(this.plane.material, this.settings.plane.material)
    this.plane.position.copy(toVec(this.settings.plane.position))
    this.light1.position.copy(toVec(this.settings.light1.position))
    this.light1.color = toColor(this.settings.light1.color)
    this.light1.intensity = this.settings.light1.intensity
    this.light2.position.copy(toVec(this.settings.light2.position))
    this.light2.color = toColor(this.settings.light2.color)
    this.light2.intensity = this.settings.light2.intensity
    this.sunlight.color = toColor(this.settings.sunlight.skyColor)
    this.sunlight.groundColor = toColor(this.settings.sunlight.groundColor)
    this.sunlight.intensity = this.settings.sunlight.intensity
    this.cameraController.applySettings(this.settings)
  }

  updateMaterial (targetMaterial, settings) {
    if ('color' in settings) targetMaterial.color = toColor(settings.color)
    if ('flatShading' in settings) {
      targetMaterial.flatShading = settings.flatShading
    }
    if ('emissive' in settings) {
      targetMaterial.emissive = toColor(settings.emissive)
    }
    if ('specular' in settings) {
      targetMaterial.specular = toColor(settings.specular)
    }
    if ('wireframe' in settings) targetMaterial.wireframe = settings.wireframe
    if ('shininess' in settings) targetMaterial.shininess = settings.shininess
  }

  // TODO: Add more granular ways to access the bim data.
  getElementNameFromNodeIndex (nodeIndex: number) {
    const vim = this.vimScene.vim
    const elementIndex = vim.bim.get('Vim.Node').get('Rvt.Element')[nodeIndex]
    const stringIndex = vim.bim.get('Rvt.Element').get('Name')[elementIndex]
    const name = vim.strings[stringIndex]
    return name
  }
}

const KEYS = {
  A: 65,
  D: 68,
  Q: 81,
  E: 69,
  S: 83,
  W: 87,
  LEFTARROW: 37,
  UPARROW: 38,
  RIGHTARROW: 39,
  DOWNARROW: 40,
  HOME: 36,
  END: 37,
  PAGEUP: 33,
  PAGEDOWN: 34,

  // Selection
  Z: 90,
  ESCAPE: 27
}

// TODO: Fix circular dependency
class ViewerInput {
  canvas: HTMLCanvasElement
  settings: any
  cameraController: ViewerCamera
  unregister: Function
  isMouseDown: Boolean

  // TODO: Fix circular dependency
  viewer: Viewer
  focusDisposer: Function

  constructor (
    canvas: HTMLCanvasElement,
    settings: any,
    cameraController: ViewerCamera
  ) {
    this.canvas = canvas
    this.settings = settings
    this.cameraController = cameraController
    this.unregister = function () {}
    this.isMouseDown = false
  }

  register () {
    this.canvas.addEventListener('mousedown', this.onMouseDown)
    this.canvas.addEventListener('wheel', this.onMouseWheel)
    this.canvas.addEventListener('mousemove', this.onMouseMove)
    this.canvas.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('keydown', this.onKeyDown)

    this.unregister = function () {
      this.canvas.removeEventListener('mousedown', this.onMouseDown)
      this.canvas.removeEventListener('wheel', this.onMouseWheel)
      this.canvas.removeEventListener('mousemove', this.onMouseMove)
      this.canvas.removeEventListener('mouseup', this.onMouseUp)
      document.removeEventListener('keydown', this.onKeyDown)

      this.isMouseDown = false
      this.unregister = function () {}
    }
  }

  onKeyDown = (event) => {
    let speed = this.settings.camera.controls.speed
    if (event.shiftKey) {
      speed *= this.settings.camera.controls.shiftMultiplier
    }
    if (event.altKey) {
      speed *= this.settings.camera.controls.altMultiplier
    }
    switch (event.keyCode) {
      // Selection
      case KEYS.ESCAPE:
        this.viewer.clearSelection()
        break
      case KEYS.Z:
        this.viewer.focusSelection()
        break
      // Camera
      case KEYS.A:
        this.cameraController.moveCameraBy(direction.left, speed)
        break
      case KEYS.LEFTARROW:
        this.cameraController.moveCameraBy(direction.left, speed, true)
        break
      case KEYS.D:
        this.cameraController.moveCameraBy(direction.right, speed)
        break
      case KEYS.RIGHTARROW:
        this.cameraController.moveCameraBy(direction.right, speed, true)
        break
      case KEYS.W:
        this.cameraController.moveCameraBy(direction.forward, speed)
        break
      case KEYS.UPARROW:
        this.cameraController.moveCameraBy(direction.forward, speed, true)
        break
      case KEYS.S:
        this.cameraController.moveCameraBy(direction.back, speed)
        break
      case KEYS.DOWNARROW:
        this.cameraController.moveCameraBy(direction.back, speed, true)
        break
      case KEYS.E:
      case KEYS.PAGEUP:
        this.cameraController.moveCameraBy(direction.up, speed)
        break
      case KEYS.Q:
      case KEYS.PAGEDOWN:
        this.cameraController.moveCameraBy(direction.down, speed)
        break
      case KEYS.HOME:
        this.cameraController.resetCamera()
        break
      default:
        return
    }
    event.preventDefault()
  }

  onMouseMove = (event) => {
    if (!this.isMouseDown) {
      return
    }

    event.preventDefault()

    // https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/PointerLockControls.js
    const deltaX =
      event.movementX || event.mozMovementX || event.webkitMovementX || 0
    const deltaY =
      event.movementY || event.mozMovementY || event.webkitMovementY || 0
    const delta = new THREE.Vector2(deltaX, deltaY)

    if (event.buttons & 2) {
      this.cameraController.panCameraBy(delta)
    } else {
      this.cameraController.rotateCameraBy(delta)
    }
  }

  onMouseWheel = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const speed = this.settings.camera.controls.zoomSpeed
    const dir = event.deltaY > 0 ? direction.back : direction.forward
    this.cameraController.moveCameraBy(dir, speed)
  }

  onMouseDown = (event) => {
    event.preventDefault()
    this.isMouseDown = true

    const hits = this.mouseRaycast(event.x, event.y)
    if (hits.length > 0) {
      const mesh = hits[0].object
      const index = hits[0].instanceId

      console.log(
        `Raycast hit. Position (${hits[0].point.x}, ${hits[0].point.y}, ${hits[0].point.z})`
      )
      if (mesh instanceof THREE.Mesh) this.viewer.select(mesh, index)
    }

    // Manually set the focus since calling preventDefault above
    // prevents the browser from setting it automatically.
    this.canvas.focus ? this.canvas.focus() : window.focus()
  }

  mouseRaycast (mouseX, mouseY) {
    const x = (mouseX / window.innerWidth) * 2 - 1
    const y = -(mouseY / window.innerHeight) * 2 + 1
    const mouse = new THREE.Vector2(x, y)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, this.cameraController.camera)
    // raycaster.firstHitOnly = true;
    return raycaster.intersectObjects(this.viewer.meshes)
  }

  onMouseUp = (_) => {
    this.isMouseDown = false
  }
}

// TODO: Fix circular dependency
class Selection {
  // Dependencies
  viewer: Viewer

  // State
  mesh: THREE.Mesh | null = null
  instanceIndex: number | null = null
  boundingSphere: THREE.Sphere | null = null

  // Disposable State
  geometry: THREE.BufferGeometry | null = null
  highlightDisposer: Function | null = null

  constructor (viewer: Viewer) {
    this.viewer = viewer
  }

  hasSelection () {
    return this.mesh !== null
  }

  reset () {
    this.mesh = null
    this.instanceIndex = null
    this.boundingSphere = null
    this.disposeResources()
  }

  disposeResources () {
    this.geometry?.dispose()
    this.geometry = null

    this.highlightDisposer?.()
    this.highlightDisposer = null
  }

  select (mesh: THREE.Mesh, index: number) {
    this.disposeResources()
    this.mesh = mesh
    this.instanceIndex = index
    this.geometry = this.viewer.createWorldGeometry(mesh, index)
    this.geometry.computeBoundingSphere()
    this.boundingSphere = this.geometry.boundingSphere
    this.highlightDisposer = this.viewer.highlight(this.geometry)
  }
}

// Helpers
function isColor (obj) {
  return typeof obj === 'object' && 'r' in obj && 'g' in obj && 'b' in obj
}

function toColor (c) {
  if (!isColor(c)) {
    throw new Error('Not a color')
  }
  return new THREE.Color(c.r / 255, c.g / 255, c.b / 255)
}

function toVec (obj) {
  return new THREE.Vector3(obj.x, obj.y, obj.z)
}

function scalarToVec (x) {
  return new THREE.Vector3(x, x, x)
}

function toEuler (rot) {
  return new THREE.Euler(
    (rot.x * Math.PI) / 180,
    (rot.y * Math.PI) / 180,
    (rot.z * Math.PI) / 180
  )
}

function toQuaternion (rot) {
  const q = new THREE.Quaternion()
  q.setFromEuler(toEuler(rot))
  return q
}
