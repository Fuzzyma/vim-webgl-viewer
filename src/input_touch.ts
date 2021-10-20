import * as THREE from 'three'
import { ViewerCamera } from './viewer_camera'
import { Viewer } from './viewer'
import { InputMouse } from './input_mouse'

export class InputTouch {
  // Consts
  TouchMoveSensitivity: number
  TouchRotateSensitivity: number

  // Dependencies
  private camera: ViewerCamera
  private viewer: Viewer
  private mouse: InputMouse

  // State
  private touchStart: THREE.Vector2 = undefined // When one touch occurs this is the value, when two or more touches occur it is the average of the first two.
  private touchStart1: THREE.Vector2 = undefined // The first touch when multiple touches occur, otherwise left undefined
  private touchStart2: THREE.Vector2 = undefined // The second touch when multiple touches occur, otherwise left undefined
  private touchStartTime: number = undefined // In ms since epoch

  constructor (camera: ViewerCamera, viewer: Viewer, mouse: InputMouse) {
    this.camera = camera
    this.viewer = viewer
    this.mouse = mouse

    this.TouchMoveSensitivity = this.mouse.MouseMoveSensitivity * 20
    this.TouchRotateSensitivity = this.mouse.MouseRotateSensitivity
  }

  reset = () => {
    this.touchStart =
      this.touchStart1 =
      this.touchStart2 =
      this.touchStartTime =
        undefined
  }

  onTap = (position: THREE.Vector2) => {
    this.mouse.onMouseClick(position)
  }

  onTouchStart = (event) => {
    event.preventDefault() // prevent scrolling
    if (!event || !event.touches || !event.touches.length) {
      return
    }
    this.touchStartTime = new Date().getTime()

    if (event.touches.length === 1) {
      this.touchStart = this.touchToVector(event.touches[0])
      this.touchStart1 = this.touchStart2 = undefined
    } else if (event.touches.length === 2) {
      this.touchStart1 = this.touchToVector(event.touches[0])
      this.touchStart2 = this.touchToVector(event.touches[1])
      this.touchStart = this.average(this.touchStart1, this.touchStart2)
    }
  }

  onDrag = (delta: THREE.Vector2) => {
    this.camera.rotateCameraBy(delta)
  }

  onDoubleDrag = (delta: THREE.Vector2) => {
    const matrix = this.viewer.getViewMatrix()
    const move = new THREE.Vector3(delta.x, 0, delta.y).applyMatrix4(matrix)
    this.camera.moveCameraBy(move, delta.length())
  }

  onPinchSpread = (delta: number) => {
    const matrix = this.viewer.getViewMatrix()
    const move = new THREE.Vector3(0, delta, 0).applyMatrix4(matrix)
    this.camera.moveCameraBy(move, Math.abs(delta))
  }

  onTouchMove = (event) => {
    if (!event || !event.touches || !event.touches.length) return

    if (event.touches.length === 1) {
      const pos = this.touchToVector(event.touches[0])
      const delta = pos.clone().sub(this.touchStart)
      this.touchStart = pos
      this.onDrag(delta)
      return
    }

    if (event.touches.length >= 2) {
      const p1 = this.touchToVector(event.touches[0])
      const p2 = this.touchToVector(event.touches[1])
      const p = this.average(p1, p2)

      const moveDelta = this.touchStart.clone().sub(p)
      const zoom = p1.distanceTo(p2)
      const prevZoom = this.touchStart1.distanceTo(this.touchStart2)
      const zoomDelta = zoom - prevZoom

      this.touchStart = p
      this.touchStart1 = p1
      this.touchStart2 = p2

      if (moveDelta.length() > Math.abs(zoomDelta)) {
        this.onDoubleDrag(moveDelta)
      } else {
        this.onPinchSpread(zoomDelta)
      }
    }
  }

  onTouchEnd = (event) => {
    if (
      this.touchStart &&
      this.touchStartTime &&
      !this.touchStart1 &&
      !this.touchStart2
    ) {
      if (new Date().getTime() - this.touchStartTime < 500) {
        this.onTap(this.touchStart)
      }
    }
    this.reset()
  }

  touchToVector (touch) {
    return new THREE.Vector2(touch.pageX, touch.pageY)
  }

  average (p1: THREE.Vector2, p2: THREE.Vector2): THREE.Vector2 {
    return p1.clone().lerp(p2, 0.5)
  }
}
