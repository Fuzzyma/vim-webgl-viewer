/**
 @author VIM / https://vimaec.com
*/

import * as THREE from 'three'
import * as BufferGeometryUtils from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'
import { G3d, VimG3d, Attribute } from './g3d'
import { BFast, BFastHeader } from './bfast'
import { Vim, VimScene, VimSceneGeometry } from './vim'

type Mesh = THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>

export class VIMLoader {
  material: THREE.Material
  timerName: string

  constructor (material: THREE.Material) {
    this.material = material
    this.timerName = 'VIM Loader'
  }

  logStart () {
    console.time(this.timerName)
  }

  log (msg: string) {
    console.timeLog(this.timerName, msg)
  }

  logEnd () {
    console.timeEnd(this.timerName)
  }

  timeAction<T> (task: string, call: () => T): T {
    console.log('Started ' + task)
    const time = 'Ended ' + task
    console.time(time)
    const result = call()
    console.timeEnd(time)
    return result
  }

  // Loads the VIM from a URL
  load (
    url: string,
    onLoad?: (response: VimScene) => void,
    onProgress?: (request: ProgressEvent) => void,
    onError?: (event: ErrorEvent) => void
  ) {
    this.logStart()

    const loader = new THREE.FileLoader()
    loader.setResponseType('arraybuffer')
    loader.setRequestHeader({
      'Content-Encoding': 'gzip'
      // 'Accept-Encoding': 'gzip, deflate'
    })

    loader.load(
      url,
      (data: string | ArrayBuffer) => {
        this.log('Data arrived')
        if (typeof data === 'string') {
          onError?.(new ErrorEvent('Unsupported string loader response'))
          return
        }
        let vim: any
        try {
          vim = this.parse(data)
        } catch (exception) {
          const error = exception as Error
          console.log(
            `Error occured when loading VIM from ${url}, message = ${error} at = ${error.stack}`
          )
          onError?.(new ErrorEvent('Loading Error', { error: exception }))
          return
        }
        // Don't catch exceptions in code provided by caller.
        this.log('Calling onLoad() parameter')
        onLoad?.(vim)
        this.log('Finished calling onLoad() parameter')
      },
      onProgress,
      onError
    )
    this.log('Finished loading')
  }

  parseBFastFromArray (bytes: Uint8Array) {
    return this.parseBFast(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  // BFAST is the container format for an array of binary arrays
  parseBFast (
    arrayBuffer: ArrayBuffer,
    byteOffset: number = 0,
    byteLength: number = arrayBuffer.byteLength - byteOffset
  ): BFast {
    // Cast the input data to 32-bit integers
    // Note that according to the spec they are 64 bit numbers. In JavaScript you can't have 64 bit integers,
    // and it would bust the amount of memory we can work with in most browsers and low-power devices
    const data = new Int32Array(arrayBuffer, byteOffset, byteLength / 4)

    // Parse the header
    const header = BFastHeader.fromArray(data, byteLength)

    // Compute each buffer
    const buffers: Uint8Array[] = []
    let pos = 8
    for (let i = 0; i < header.numArrays; ++i) {
      const begin = data[pos + 0]
      const end = data[pos + 2]

      // Check validity of data
      if (data[pos + 1] !== 0) {
        throw new Error('Expected 0 in position ' + (pos + 1) * 4)
      }
      if (data[pos + 3] !== 0) {
        throw new Error('Expected 0 in position ' + (pos + 3) * 4)
      }
      if (begin < header.dataStart || begin > header.dataEnd) {
        throw new Error('Buffer start is out of range')
      }
      if (end < begin || end > header.dataEnd) {
        throw new Error('Buffer end is out of range')
      }

      pos += 4
      const buffer = new Uint8Array(
        arrayBuffer,
        begin + byteOffset,
        end - begin
      )
      buffers.push(buffer)
    }

    if (buffers.length < 0) {
      throw new Error('Expected at least one buffer containing the names')
    }

    // break the first one up into names
    const joinedNames = new TextDecoder('utf-8').decode(buffers[0])

    // Removing the trailing '\0' before spliting the names
    let names = joinedNames.slice(0, -1).split('\0')
    if (joinedNames.length === 0) names = []

    // Validate the number of names
    if (names.length !== buffers.length - 1) {
      throw new Error(
        'Expected number of names to be equal to the number of buffers - 1'
      )
    }

    return new BFast(header, names, buffers.slice(1))
  }

  constructEntityTable (bfast: BFast) {
    const result = new Map<string, any>()
    for (let i = 0; i < bfast.buffers.length; ++i) {
      const tmp = bfast.names[i].split(':')
      const columnType = tmp[0]
      const columnName = tmp[1]
      const buffer = bfast.buffers[i]
      let columnData
      if (columnType === 'numeric') {
        columnData = new Float64Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / 8
        )
        result.set(columnName, columnData)
      } else if (columnType === 'string' || columnType === 'index') {
        columnData = new Int32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / 4
        )
        result.set(columnName, columnData)
      } else if (columnType === 'properties') {
        columnData = new Int32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / 4
        )
        // TODO Fix this JS
        result.set('properties', buffer)
      } else {
        throw new Error('Unrecognized column type ' + columnType)
      }
    }
    return result
  }

  constructEntityTables (bfast: BFast): any {
    const result = new Map<string, any>()
    for (let i = 0; i < bfast.buffers.length; ++i) {
      const current = bfast.names[i]
      const tableName = current.substring(current.indexOf(':') + 1)
      const buffer = bfast.buffers[i]
      this.log(
        `Constructing entity table ${current} which is ${buffer.length} size`
      )
      const next = this.constructEntityTable(this.parseBFastFromArray(buffer))
      result.set(tableName, next)
    }
    return result
  }

  // Given a BFAST container (header/names/buffers) constructs a VIM data structure
  constructVIM = (bfast: any): Vim => {
    if (bfast.buffers.length < 5) {
      throw new Error('VIM requires at least five BFast buffers')
    }

    const lookup = new Map<string, any>()
    for (let i = 0; i < bfast.buffers.length; ++i) {
      lookup.set(bfast.names[i], bfast.buffers[i])
    }

    const assetData = lookup.get('assets')
    const g3dData = lookup.get('geometry')
    const headerData = lookup.get('header')
    const entityData = lookup.get('entities')
    const stringData = lookup.get('strings')

    this.log(`Parsing header: ${headerData.length} bytes`)
    const header = new TextDecoder('utf-8').decode(headerData)

    this.log(`Constructing G3D: ${g3dData.length} bytes`)
    const g3d = new VimG3d(this.constructG3D(this.parseBFastFromArray(g3dData)))
    this.log('Validating G3D')
    g3d.validate()

    this.log(`Retrieving assets: ${assetData.length} bytes`)
    const assets = this.parseBFastFromArray(assetData)
    this.log(`Found ${assets.buffers.length} assets`)

    this.log(`Constructing entity tables: ${entityData.length} bytes`)
    const entities = this.constructEntityTables(
      this.parseBFastFromArray(entityData)
    )
    this.log(`Found ${entities.length} entity tables`)

    this.log(`Decoding strings: ${stringData.length} bytes`)
    const strings = new TextDecoder('utf-8').decode(stringData).split('\0')
    this.log(`Found ${strings.length} strings`)

    return new Vim(header, assets, g3d, entities, strings)
  }

  // Given a BFAST container (header/names/buffers) constructs a G3D data structure
  constructG3D (bfast: BFast): G3d {
    console.log('Constructing G3D')

    if (bfast.buffers.length < 2) {
      throw new Error('G3D requires at least two BFast buffers')
    }

    // Parse first buffer as Meta
    const metaBuffer = bfast.buffers[0]
    if (bfast.names[0] !== 'meta') {
      throw new Error(
        "First G3D buffer must be named 'meta', but was named: " +
          bfast.names[0]
      )
    }
    const meta = new TextDecoder('utf-8').decode(metaBuffer)

    // Parse remaining buffers as Attributes
    const attributes: Attribute[] = []
    const nDescriptors = bfast.buffers.length - 1
    for (let i = 0; i < nDescriptors; ++i) {
      const attribute = Attribute.fromString(
        bfast.names[i + 1],
        bfast.buffers[i + 1]
      )
      attributes.push(attribute)
      console.log(`Attribute ${i} = ${attribute.descriptor.description}`)
    }

    return new G3d(meta, attributes)
  }

  createBufferGeometry (
    vertices: Float32Array,
    indices: Int32Array,
    vertexColors: Float32Array | undefined = undefined
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()

    // Vertices
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))

    // Indices
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1))

    // Colors
    if (vertexColors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3))
    }

    return geometry
  }

  allocateGeometry = (g3d: VimG3d): THREE.BufferGeometry[] => {
    const meshCount = g3d.meshSubmeshes.length
    // A full-sized temp color buffer because we don't know the vertex count of buffers in advance
    const colorBuffer = new Float32Array(g3d.positions.length)
    const indexBuffer = new Int32Array(g3d.indices.length)
    const resultMeshes: THREE.BufferGeometry[] = []

    for (let mesh = 0; mesh < meshCount; mesh++) {
      // min and max indices accumulated to slice into the vertex buffer
      let min: number = Number.MAX_SAFE_INTEGER
      let max: number = 0
      let indexCount = 0

      const [meshStart, meshEnd] = g3d.getMeshSubmeshRange(mesh)
      for (let submesh = meshStart; submesh < meshEnd; submesh++) {
        // transparent submeshes are skipped
        const submeshColor = this.getSubmeshColor(g3d, submesh)
        if (!submeshColor) continue

        const [submeshStart, submeshEnd] = g3d.getSubmeshIndexRange(submesh)
        for (let index = submeshStart; index < submeshEnd; index++) {
          const vertex = g3d.indices[index]
          indexBuffer[indexCount++] = vertex
          min = Math.min(min, vertex)
          max = Math.max(max, vertex)
          submeshColor.toArray(colorBuffer, vertex * 3)
        }
      }

      // If all submesh are transparent, we push null to keep results aligned
      // if (meshIndices.length === 0) {
      if (indexCount === 0) {
        resultMeshes.push(null)
        continue
      }

      // 3 is both the arity of the vertex buffer and of THREE.color
      const sliceStart = min * 3
      const sliceEnd = (max + 1) * 3

      // Rebase indices in mesh space
      for (let i = 0; i < indexCount; i++) {
        indexBuffer[i] -= min
      }

      const resultMesh = this.createBufferGeometry(
        g3d.positions.subarray(sliceStart, sliceEnd),
        indexBuffer.subarray(0, indexCount),
        colorBuffer.subarray(sliceStart, sliceEnd)
      )

      resultMesh.computeBoundingSphere()
      resultMesh.computeBoundingBox()
      resultMeshes.push(resultMesh)
    }

    return resultMeshes
  }

  defaultColor = new THREE.Color(0.5, 0.5, 0.5)
  getSubmeshColor (g3d: VimG3d, submesh: number) {
    const material = g3d.submeshMaterial[submesh]
    if (material < 0) {
      return this.defaultColor
    }

    const colorIndex = material * g3d.colorArity
    const alpha = g3d.materialColors[colorIndex + 3]
    if (alpha < 0.9) {
      return // to skip transparent materials
    }

    return new THREE.Color().fromArray(g3d.materialColors, colorIndex)
  }

  // Main
  parse (data: ArrayBuffer): VimScene {
    const bfast = this.timeAction('Parsing Vim', () => this.parseBFast(data))

    console.log(`found: ${bfast.buffers.length} buffers`)
    console.log(bfast.names.join(', '))

    const vim = this.timeAction('Creating VIM', () => this.constructVIM(bfast))

    const geometry = this.timeAction('Allocating Geometry', () =>
      this.allocateGeometry(vim.g3d)
    )
    console.log('Found # meshes ' + geometry.length)

    const meshRefCounts = this.timeAction('Counting references', () =>
      this.countMeshReferences(vim.g3d.instanceMeshes, geometry.length)
    )

    const rawMeshes = this.timeAction('Allocating Meshes', () =>
      this.allocateMeshes(geometry, meshRefCounts)
    )

    const sceneGeometry = this.timeAction('Applying Matrices', () =>
      this.applyMatrices(
        rawMeshes,
        vim.g3d.instanceMeshes,
        vim.g3d.instanceTransforms
      )
    )

    console.log('Merging geometry')
    const singles: THREE.BufferGeometry[] = []
    for (let i = 0; i < vim.g3d.instanceMeshes.length; i++) {
      const meshIndex = vim.g3d.instanceMeshes[i]
      if (meshIndex < 0) continue

      const mesh = geometry[meshIndex]
      if (!mesh) continue

      if (meshRefCounts[meshIndex] === 1) {
        const matrixAsArray = vim.g3d.instanceTransforms.subarray(
          i * vim.g3d.matrixArity,
          (i + 1) * vim.g3d.matrixArity
        )
        const matrix = new THREE.Matrix4()
        matrix.elements = Array.from(matrixAsArray)
        mesh.applyMatrix4(matrix)
        singles.push(mesh)
      }
    }

    const big: THREE.BufferGeometry =
      BufferGeometryUtils.mergeBufferGeometries(singles)
    const bigMesh = new THREE.InstancedMesh(big, this.material, 1)
    bigMesh.setMatrixAt(0, new THREE.Matrix4())
    big.computeBoundingSphere()
    sceneGeometry.meshes.push(bigMesh)
    sceneGeometry.boundingSphere = big.boundingSphere

    console.log('Loading Completed')
    return new VimScene(vim, sceneGeometry)
  }

  countMeshReferences = (
    instanceMeshes: Int32Array,
    meshCount: number
  ): Int32Array => {
    const meshRefCounts = new Int32Array(meshCount)
    for (let i = 0; i < instanceMeshes.length; ++i) {
      const mesh = instanceMeshes[i]
      if (mesh < 0) continue
      meshRefCounts[mesh]++
    }
    return meshRefCounts
  }

  allocateMeshes (
    geometries: THREE.BufferGeometry[],
    meshRefCounts: Int32Array
  ): (Mesh | null)[] {
    const meshCount = geometries.length
    const meshes: (Mesh | null)[] = []

    for (let i = 0; i < meshCount; ++i) {
      const count = meshRefCounts[i]
      if (count <= 1) {
        meshes.push(null)
        continue
      }

      const geometry = geometries[i]
      if (geometry === null) {
        meshes.push(null)
        continue
      }

      const mesh = new THREE.InstancedMesh(geometry, this.material, count)
      meshes.push(mesh)
    }

    return meshes
  }

  // meshes: array of THREE.InstancedMesh
  // instanceMeshes: array of mesh indices
  // instanceTransform: flat array of matrix4x4
  // Returns array of InstancedMesh and array of instance centers with matrices applied to both.
  applyMatrices (
    meshes: (Mesh | null)[],
    instanceMeshes: Int32Array,
    instanceTransforms: Float32Array
  ): VimSceneGeometry {
    const matrixArity = 16
    const instanceCounters = new Int32Array(meshes.length)
    let boundingSphere: THREE.Sphere | null = null
    const nodeIndexToMeshInstance = new Map<number, [Mesh, number]>()
    const meshIdToNodeIndex = new Map<number, [number]>()
    const resultMeshes: Mesh[] = []

    for (let i = 0; i < instanceMeshes.length; ++i) {
      const meshIndex = instanceMeshes[i]
      if (meshIndex < 0) continue

      const mesh = meshes[meshIndex]
      if (!mesh) continue

      const count = instanceCounters[meshIndex]++

      // Compute Matrix
      const matrixAsArray = instanceTransforms.subarray(
        i * matrixArity,
        (i + 1) * matrixArity
      )
      const matrix = new THREE.Matrix4()
      matrix.elements = Array.from(matrixAsArray)
      mesh.setMatrixAt(count, matrix)

      // Set Node ID for picking
      nodeIndexToMeshInstance.set(i, [mesh, count])

      const nodes = meshIdToNodeIndex.get(mesh.id)
      if (nodes) {
        nodes.push(i)
      } else {
        meshIdToNodeIndex.set(mesh.id, [i])
        resultMeshes.push(mesh) // push mesh first time it is seen
      }

      // Sphere was computed when geometry was created
      const sphere = mesh.geometry.boundingSphere!.clone()
      sphere.applyMatrix4(matrix)
      boundingSphere = boundingSphere ? boundingSphere.union(sphere) : sphere
    }
    return new VimSceneGeometry(
      resultMeshes,
      boundingSphere ?? new THREE.Sphere(),
      nodeIndexToMeshInstance,
      meshIdToNodeIndex
    )
  }
}
