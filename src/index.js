//@ts-check
//paintvidget imports
import "vtk.js/Sources/favicon";
import * as vtkMath from "vtk.js/Sources/Common/Core/Math";
import vtkFullScreenRenderWindow from "vtk.js/Sources/Rendering/Misc/FullScreenRenderWindow";
import vtkWidgetManager from "vtk.js/Sources/Widgets/Core/WidgetManager";
import vtkPaintWidget from "vtk.js/Sources/Widgets/Widgets3D/PaintWidget";
import vtkRectangleWidget from "vtk.js/Sources/Widgets/Widgets3D/RectangleWidget";
import vtkEllipseWidget from "vtk.js/Sources/Widgets/Widgets3D/EllipseWidget";
import vtkSplineWidget from "vtk.js/Sources/Widgets/Widgets3D/SplineWidget";
import vtkInteractorStyleImage from "vtk.js/Sources/Interaction/Style/InteractorStyleImage";
import vtkImageMapper from "vtk.js/Sources/Rendering/Core/ImageMapper";
import vtkImageSlice from "vtk.js/Sources/Rendering/Core/ImageSlice";
import vtkPaintFilter from "vtk.js/Sources/Filters/General/PaintFilter";

import {
    BehaviorCategory,
    ShapeBehavior
} from "vtk.js/Sources/Widgets/Widgets3D/ShapeWidget/Constants";
import {
    TextAlign,
    VerticalAlign
} from "vtk.js/Sources/Interaction/Widgets/LabelRepresentation/Constants";

import { ViewTypes } from "vtk.js/Sources/Widgets/Core/WidgetManager/Constants";

import { vec3 } from "gl-matrix";


import controlPanel from "./controlPanel.html";

//volume viewer imports

import "vtk.js/Sources/favicon";
import macro from "vtk.js/Sources/macro";
import HttpDataAccessHelper from "vtk.js/Sources/IO/Core/DataAccessHelper/HttpDataAccessHelper";
import vtkBoundingBox from "vtk.js/Sources/Common/DataModel/BoundingBox";
import vtkColorTransferFunction from "vtk.js/Sources/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "vtk.js/Sources/Common/DataModel/PiecewiseFunction";
import vtkURLExtract from "vtk.js/Sources/Common/Core/URLExtract";
import vtkXMLImageDataReader from "vtk.js/Sources/IO/XML/XMLImageDataReader";
import vtkFPSMonitor from "vtk.js/Sources/Interaction/UI/FPSMonitor";
import style from "./VolumeViewer.module.css";

let autoInit = true;
const userParams = vtkURLExtract.extractURLParameters();
const fpsMonitor = vtkFPSMonitor.newInstance();

// ----------------------------------------------------------------------------
// Add class to body if iOS device
// ----------------------------------------------------------------------------

const iOS = /iPad|iPhone|iPod/.test(window.navigator.platform);

if (iOS) {
    document.querySelector("body").classList.add("is-ios-device");
}

// ----------------------------------------------------------------------------

function emptyContainer(container) {
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
}

// ----------------------------------------------------------------------------

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// ----------------------------------------------------------------------------

export function load(container, options) {
    autoInit = false;
    emptyContainer(container);

    if (options.file) {
        if (options.ext === "vti") {
            const reader = new FileReader();
            reader.onload = function onLoad(e) {
                createViewer(container, reader.result, options);
            };
            reader.readAsArrayBuffer(options.file);
        } else {
            console.error("Unkown file...");
        }
    } else if (options.fileURL) {
        const progressContainer = document.createElement("div");
        progressContainer.setAttribute("class", style.progress);
        container.appendChild(progressContainer);

        const progressCallback = (progressEvent) => {
            if (progressEvent.lengthComputable) {
                const percent = Math.floor(
                    (100 * progressEvent.loaded) / progressEvent.total
                );
                progressContainer.innerHTML = `Loading ${percent}%`;
            } else {
                progressContainer.innerHTML = macro.formatBytesToProperUnit(
                    progressEvent.loaded
                );
            }
        };

        HttpDataAccessHelper.fetchBinary(options.fileURL, {
            progressCallback
        }).then((binary) => {
            container.removeChild(progressContainer);
            createViewer(container, binary, options);
        });
    }
}

export function initLocalFileLoader(container) {
    const exampleContainer = document.querySelector(".content");
    const rootBody = document.querySelector("body");
    const myContainer = container || exampleContainer || rootBody;

    const fileContainer = document.createElement("div");
    fileContainer.innerHTML = `<div class="${style.bigFileDrop}"/><input type="file" accept=".vti" style="display: none;"/>`;
    myContainer.appendChild(fileContainer);

    const fileInput = fileContainer.querySelector("input");

    function handleFile(e) {
        preventDefaults(e);
        const dataTransfer = e.dataTransfer;
        const files = e.target.files || dataTransfer.files;
        if (files.length === 1) {
            myContainer.removeChild(fileContainer);
            const ext = files[0].name.split(".").slice(-1)[0];
            const options = Object.assign({ file: files[0], ext }, userParams);
            load(myContainer, options);
        }
    }

    fileInput.addEventListener("change", handleFile);
    fileContainer.addEventListener("drop", handleFile);
    fileContainer.addEventListener("click", (e) => fileInput.click());
    fileContainer.addEventListener("dragover", preventDefaults);
}
// ----------------------------------------------------------------------------
// Standard rendering code setup
// ----------------------------------------------------------------------------

function setCamera(sliceMode, renderer, data) {
    const ijk = [0, 0, 0];
    const position = [0, 0, 0];
    const focalPoint = [0, 0, 0];
    data.indexToWorldVec3(ijk, focalPoint);
    ijk[sliceMode] = 1;
    data.indexToWorldVec3(ijk, position);
    renderer.getActiveCamera().set({ focalPoint, position });
    renderer.resetCamera();
}

// ----------------------------------------------------------------------------
// Load image
// ----------------------------------------------------------------------------
function createViewer(rootContainer, fileContents, options) {
    const background = options.background ?
        options.background.split(",").map((s) => Number(s)) :
        [0, 0, 0];
    const containerStyle = options.containerStyle;
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
        background,
        rootContainer,
        containerStyle
    });

    // scene
    const scene = {};

    scene.fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
        rootContainer: document.body,
        background: [0.1, 0.1, 0.1]
    });

    scene.renderer = scene.fullScreenRenderer.getRenderer();
    scene.renderWindow = scene.fullScreenRenderer.getRenderWindow();
    scene.openGLRenderWindow = scene.fullScreenRenderer.getOpenGLRenderWindow();
    scene.camera = scene.renderer.getActiveCamera();

    // setup 2D view
    scene.camera.setParallelProjection(true);
    scene.iStyle = vtkInteractorStyleImage.newInstance();
    scene.iStyle.setInteractionMode("IMAGE_SLICING");
    scene.renderWindow.getInteractor().setInteractorStyle(scene.iStyle);
    scene.fullScreenRenderer.addController(controlPanel);

    // ----------------------------------------------------------------------------
    // Widget manager and vtkPaintFilter
    // ----------------------------------------------------------------------------

    scene.widgetManager = vtkWidgetManager.newInstance();
    scene.widgetManager.setRenderer(scene.renderer);

    // Widgets
    const widgets = {};
    widgets.paintWidget = vtkPaintWidget.newInstance();
    widgets.rectangleWidget = vtkRectangleWidget.newInstance();
    widgets.ellipseWidget = vtkEllipseWidget.newInstance();
    widgets.circleWidget = vtkEllipseWidget.newInstance({
        modifierBehavior: {
            None: {
                [BehaviorCategory.PLACEMENT]: ShapeBehavior[BehaviorCategory.PLACEMENT].CLICK_AND_DRAG,
                [BehaviorCategory.POINTS]: ShapeBehavior[BehaviorCategory.POINTS].RADIUS,
                [BehaviorCategory.RATIO]: ShapeBehavior[BehaviorCategory.RATIO].FREE
            },
            Control: {
                [BehaviorCategory.POINTS]: ShapeBehavior[BehaviorCategory.POINTS].DIAMETER
            }
        }
    });
    widgets.splineWidget = vtkSplineWidget.newInstance();
    widgets.polygonWidget = vtkSplineWidget.newInstance({
        resolution: 1
    });

    scene.paintHandle = scene.widgetManager.addWidget(
        widgets.paintWidget,
        ViewTypes.SLICE
    );
    scene.rectangleHandle = scene.widgetManager.addWidget(
        widgets.rectangleWidget,
        ViewTypes.SLICE
    );
    scene.ellipseHandle = scene.widgetManager.addWidget(
        widgets.ellipseWidget,
        ViewTypes.SLICE
    );
    scene.circleHandle = scene.widgetManager.addWidget(
        widgets.circleWidget,
        ViewTypes.SLICE
    );
    scene.splineHandle = scene.widgetManager.addWidget(
        widgets.splineWidget,
        ViewTypes.SLICE
    );
    scene.polygonHandle = scene.widgetManager.addWidget(
        widgets.polygonWidget,
        ViewTypes.SLICE
    );

    scene.splineHandle.setOutputBorder(true);
    scene.polygonHandle.setOutputBorder(true);

    scene.widgetManager.grabFocus(widgets.paintWidget);
    let activeWidget = "paintWidget";

    // Paint filter
    const painter = vtkPaintFilter.newInstance();

    // ----------------------------------------------------------------------------
    // Ready logic
    // ----------------------------------------------------------------------------

    function ready(scope, picking = false) {
        scope.renderer.resetCamera();
        scope.fullScreenRenderer.resize();
        if (picking) {
            scope.widgetManager.enablePicking();
        } else {
            scope.widgetManager.disablePicking();
        }
    }

    function readyAll() {
        ready(scene, true);
    }

    function updateControlPanel(im, ds) {
        const slicingMode = im.getSlicingMode();
        const extent = ds.getExtent();
        document
            .querySelector(".slice")
            .setAttribute("max", extent[slicingMode * 2 + 1]);
    }

    const image = {
        mapper: vtkImageMapper.newInstance(),
        actor: vtkImageSlice.newInstance()
    };

    const labelMap = {
        imageMapper: vtkImageMapper.newInstance(),
        actor: vtkImageSlice.newInstance(),
        cfun: vtkColorTransferFunction.newInstance(),
        ofun: vtkPiecewiseFunction.newInstance()
    };

    // background image pipeline
    image.actor.setMapper(image.mapper);

    // labelmap pipeline
    labelMap.actor.setMapper(labelMap.imageMapper);
    labelMap.imageMapper.setInputConnection(painter.getOutputPort());

    // set up labelMap color and opacity mapping
    labelMap.cfun.addRGBPoint(1, 0, 0, 1); // label "1" will be blue
    labelMap.ofun.addPoint(0, 0); // our background value, 0, will be invisible
    labelMap.ofun.addPoint(1, 1); // all values above 1 will be fully opaque

    labelMap.actor.getProperty().setRGBTransferFunction(labelMap.cfun);
    labelMap.actor.getProperty().setPiecewiseFunction(labelMap.ofun);
    // opacity is applied to entire labelmap
    labelMap.actor.getProperty().setOpacity(0.5);

    const vtiReader = vtkXMLImageDataReader.newInstance();
    vtiReader.parseAsArrayBuffer(fileContents);

    const data = vtiReader.getOutputData(0);
    image.data = data;

    // set input data
    image.mapper.setInputData(data);

    // add actors to renderers
    scene.renderer.addViewProp(image.actor);
    scene.renderer.addViewProp(labelMap.actor);

    // update paint filter
    painter.setBackgroundImage(image.data);
    // don't set to 0, since that's our empty label color from our pwf
    painter.setLabel(1);
    // set custom threshold
    // painter.setVoxelFunc((bgValue, idx) => bgValue < 145);

    // default slice orientation/mode and camera view
    const sliceMode = vtkImageMapper.SlicingMode.K;
    image.mapper.setSlicingMode(sliceMode);
    image.mapper.setSlice(0);
    painter.setSlicingMode(sliceMode);

    // set 2D camera position
    setCamera(sliceMode, scene.renderer, image.data);

    updateControlPanel(image.mapper, data);

    scene.circleHandle.setLabelTextCallback((worldBounds, screenBounds) => {
        const center = vtkBoundingBox.getCenter(screenBounds);
        const radius =
            vec3.distance(center, [
                screenBounds[0],
                screenBounds[2],
                screenBounds[4]
            ]) / 2;
        const position = [0, 0, 0];
        vec3.scaleAndAdd(position, center, [1, 1, 1], radius);

        return {
            text: `radius: ${(
        vec3.distance(
          [worldBounds[0], worldBounds[2], worldBounds[4]],
          [worldBounds[1], worldBounds[3], worldBounds[5]]
        ) / 2
      ).toFixed(2)}`,
            position,
            textAlign: TextAlign.CENTER,
            verticalAlign: VerticalAlign.CENTER
        };
    });

    scene.splineHandle
        .getWidgetState()
        .getMoveHandle()
        .setScale1(2 * Math.max(...image.data.getSpacing()));
    scene.splineHandle.setFreehandMinDistance(
        4 * Math.max(...image.data.getSpacing())
    );

    scene.polygonHandle
        .getWidgetState()
        .getMoveHandle()
        .setScale1(2 * Math.max(...image.data.getSpacing()));
    scene.polygonHandle.setFreehandMinDistance(
        4 * Math.max(...image.data.getSpacing())
    );

    const update = () => {
        const slicingMode = image.mapper.getSlicingMode() % 3;

        if (slicingMode > -1) {
            const ijk = [0, 0, 0];
            const position = [0, 0, 0];
            const normal = [0, 0, 0];

            // position
            ijk[slicingMode] = image.mapper.getSlice();
            data.indexToWorldVec3(ijk, position);

            // circle/slice normal
            ijk[slicingMode] = 1;
            data.indexToWorldVec3(ijk, normal);
            vtkMath.subtract(normal, data.getOrigin(), normal);
            vtkMath.normalize(normal);

            widgets.paintWidget.getManipulator().setOrigin(position);
            widgets.paintWidget.getManipulator().setNormal(normal);
            widgets.rectangleWidget.getManipulator().setOrigin(position);
            widgets.rectangleWidget.getManipulator().setNormal(normal);
            widgets.ellipseWidget.getManipulator().setOrigin(position);
            widgets.ellipseWidget.getManipulator().setNormal(normal);
            widgets.circleWidget.getManipulator().setOrigin(position);
            widgets.circleWidget.getManipulator().setNormal(normal);
            widgets.splineWidget.getManipulator().setOrigin(position);
            widgets.splineWidget.getManipulator().setNormal(normal);
            widgets.polygonWidget.getManipulator().setOrigin(position);
            widgets.polygonWidget.getManipulator().setNormal(normal);

            painter.setSlicingMode(slicingMode);

            scene.paintHandle.updateRepresentationForRender();
            scene.rectangleHandle.updateRepresentationForRender();
            scene.ellipseHandle.updateRepresentationForRender();
            scene.circleHandle.updateRepresentationForRender();
            scene.splineHandle.updateRepresentationForRender();
            scene.polygonHandle.updateRepresentationForRender();

            // update labelMap layer
            labelMap.imageMapper.set(image.mapper.get("slice", "slicingMode"));

            // update UI
            document
                .querySelector(".slice")
                .setAttribute("max", data.getDimensions()[slicingMode] - 1);
        }
    };
    image.mapper.onModified(update);
    // trigger initial update
    update();

    readyAll();
    //});

    // register readyAll to resize event
    window.addEventListener("resize", readyAll);
    readyAll();

    // ----------------------------------------------------------------------------
    // UI logic
    // ----------------------------------------------------------------------------

    document.querySelector(".radius").addEventListener("input", (ev) => {
        const r = Number(ev.target.value);

        widgets.paintWidget.setRadius(r);
        painter.setRadius(r);
    });

    document.querySelector(".slice").addEventListener("input", (ev) => {
        image.mapper.setSlice(Number(ev.target.value));
    });

    document.querySelector(".axis").addEventListener("input", (ev) => {
        const sliceMode = "IJKXYZ".indexOf(ev.target.value) % 3;
        image.mapper.setSlicingMode(sliceMode);
        painter.setSlicingMode(sliceMode);

        const direction = [0, 0, 0];
        direction[sliceMode] = 1;
        scene.paintHandle.getWidgetState().getHandle().setDirection(direction);

        setCamera(sliceMode, scene.renderer, image.data);
        scene.renderWindow.render();
    });

    document.querySelector(".widget").addEventListener("input", (ev) => {
        activeWidget = ev.target.value;
        scene.widgetManager.grabFocus(widgets[activeWidget]);

        scene.paintHandle.setVisibility(activeWidget === "paintWidget");
        scene.paintHandle.updateRepresentationForRender();

        scene.splineHandle.reset();
        scene.splineHandle.setVisibility(activeWidget === "splineWidget");
        scene.splineHandle.updateRepresentationForRender();

        scene.polygonHandle.reset();
        scene.polygonHandle.setVisibility(activeWidget === "polygonWidget");
        scene.polygonHandle.updateRepresentationForRender();
    });

    document.querySelector(".focus").addEventListener("click", () => {
        scene.widgetManager.grabFocus(widgets[activeWidget]);
    });

    document.querySelector(".undo").addEventListener("click", () => {
        painter.undo();
    });

    document.querySelector(".redo").addEventListener("click", () => {
        painter.redo();
    });

    // ----------------------------------------------------------------------------
    // Painting
    // ----------------------------------------------------------------------------

    function initializeHandle(handle) {
        handle.onStartInteractionEvent(() => {
            painter.startStroke();
        });

        handle.onEndInteractionEvent(() => {
            painter.endStroke();
        });
    }

    initializeHandle(scene.paintHandle);

    scene.paintHandle.onStartInteractionEvent(() => {
        painter.startStroke();
        painter.addPoint(widgets.paintWidget.getWidgetState().getTrueOrigin());
    });

    scene.paintHandle.onInteractionEvent(() => {
        painter.addPoint(widgets.paintWidget.getWidgetState().getTrueOrigin());
    });

    initializeHandle(scene.rectangleHandle);

    scene.rectangleHandle.onInteractionEvent(() => {
        const rectangleHandle = scene.rectangleHandle
            .getWidgetState()
            .getRectangleHandle();
        painter.paintRectangle(
            rectangleHandle.getOrigin(),
            rectangleHandle.getCorner()
        );
    });

    initializeHandle(scene.ellipseHandle);

    scene.ellipseHandle.onInteractionEvent(() => {
        const center = scene.ellipseHandle
            .getWidgetState()
            .getEllipseHandle()
            .getOrigin();
        const scale3 = scene.ellipseHandle
            .getWidgetState()
            .getEllipseHandle()
            .getScale3();
        painter.paintEllipse(center, scale3);
    });

    initializeHandle(scene.circleHandle);

    scene.circleHandle.onInteractionEvent(() => {
        const center = scene.circleHandle
            .getWidgetState()
            .getEllipseHandle()
            .getOrigin();
        const scale3 = scene.circleHandle
            .getWidgetState()
            .getEllipseHandle()
            .getScale3();
        painter.paintEllipse(center, scale3);
    });

    scene.splineHandle.onStartInteractionEvent(() => {
        painter.startStroke();
    });

    scene.splineHandle.onEndInteractionEvent(() => {
        const points = scene.splineHandle.getPoints();
        painter.paintPolygon(points);
        painter.endStroke();

        scene.splineHandle.reset();
        scene.splineHandle.updateRepresentationForRender();
        scene.widgetManager.grabFocus(widgets.splineWidget);
    });

    scene.polygonHandle.onStartInteractionEvent(() => {
        painter.startStroke();
    });

    scene.polygonHandle.onEndInteractionEvent(() => {
        const points = scene.polygonHandle.getPoints();
        painter.paintPolygon(points);
        painter.endStroke();

        scene.polygonHandle.reset();
        scene.polygonHandle.updateRepresentationForRender();
        scene.widgetManager.grabFocus(widgets.polygonWidget);
    });
}

// Auto setup if no method get called within 100ms
setTimeout(() => {
    if (autoInit) {
        initLocalFileLoader();
    }
}, 100);