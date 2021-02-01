function reassignManipulators() {
    interactorStyle.removeAllMouseManipulators();
    Object.keys(uiComponents).forEach((keyName) => {
      const klass = manipulatorFactory[uiComponents[keyName].manipName];
      if (klass) {
        const manipulator = klass.newInstance();
        manipulator.setButton(selectMap[keyName].button);
        manipulator.setShift(!!selectMap[keyName].shift);
        manipulator.setControl(!!selectMap[keyName].control);
        manipulator.setAlt(!!selectMap[keyName].alt);
        if (selectMap[keyName].scrollEnabled !== undefined) {
          manipulator.setScrollEnabled(selectMap[keyName].scrollEnabled);
        }
        if (selectMap[keyName].dragEnabled !== undefined) {
          manipulator.setDragEnabled(selectMap[keyName].dragEnabled);
        }
        interactorStyle.addMouseManipulator(manipulator);
      }
    });
  
    // Always add gesture
    interactorStyle.addGestureManipulator(
      vtkGestureCameraManipulator.newInstance()
    );
  }