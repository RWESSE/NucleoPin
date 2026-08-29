# NucleoPin

**A visual STM32 NUCLEO-F401RE / NUCLEO-F411RE project companion for Windows.**

NucleoPin makes it easier to understand and work with STM32CubeMX `.ioc` projects by showing your configured pins on a clear, interactive representation of the Nucleo board.

Instead of constantly switching between pin tables, datasheets and CubeMX, NucleoPin gives you a quick visual overview of what your project is actually using.

---

## Features

### Real Board View

View your project directly on a representation of the physical NUCLEO board.

- Physical connector positions
- Interactive pin hotspots
- Hover/click pin information
- Used and free pin highlighting
- GPIO, communications and ADC filtering
- Support for Arduino and Morpho headers

### Classic Pinout View

Switch to a traditional pinout layout when you want a more technical overview of the board.

The Classic Pinout is also used for printing so project documentation remains clear and easy to read.

### STM32CubeMX `.ioc` Support

Open an existing STM32CubeMX `.ioc` project and NucleoPin will analyse the configuration.

NucleoPin is intentionally **read-only**.

Your `.ioc` file remains the source of truth and is never copied, moved or modified by NucleoPin.

Use **Open in CubeMX** whenever you want to change the MCU configuration. After saving the project in CubeMX, NucleoPin can reload the updated configuration.

### Project Library

Keep track of multiple STM32 projects from one place.

NucleoPin remembers the original location of each `.ioc` file so projects can remain anywhere on your computer.

### Smart Project Check

NucleoPin can inspect the active project and highlight useful information or potential problems, including pin usage and common NUCLEO board conflicts.

### Component & Wiring Planning

Add components to your project and keep track of how they connect to the Nucleo board.

This makes NucleoPin useful not only for MCU configuration, but also while building the actual circuit.

### Find Free Pins

Need another GPIO, ADC or communications pin?

Use the project filters and **Find Free** tools to quickly identify available pins without manually searching the entire board.

### Project Documentation

Generate a printable project reference containing your pin configuration, wiring information and parts checklist.

Printing always uses the clean **Classic Pinout** layout.

### Automatic Updates

NucleoPin includes an integrated updater.

When a new release is available, you can download and install it directly from the application.

The application also remembers its window size, position and maximized state between launches.

---

## Supported Boards

Current support:

- STM32 NUCLEO-F401RE
- STM32 NUCLEO-F411RE

More STM32 Nucleo boards may be added in future releases.

---

## Installation

Download the latest Windows installer from the **Releases** section of this repository.

Run:

`NucleoPin_x.x.x_x64-setup.exe`

NucleoPin currently targets **64-bit Windows**.

> Windows may display a SmartScreen warning because the installer is not currently Authenticode code-signed.

---

## Basic Workflow

1. Open NucleoPin.
2. Add or open your STM32CubeMX `.ioc` project.
3. View the configured pins using **Real Board** or **Classic Pinout**.
4. Use the filters to inspect used, free, GPIO, communications or ADC pins.
5. Add components and wiring information if required.
6. Run **Smart Project Check**.
7. Use **Open in CubeMX** when you need to modify the MCU configuration.
8. Save the project in CubeMX and return to NucleoPin.
9. Reload the `.ioc` configuration.
10. Print your project reference when required.

---

## Why NucleoPin?

STM32CubeMX is excellent for configuring the microcontroller, but during development it can still be difficult to answer simple physical questions quickly:

- Which header is this GPIO actually on?
- Which pins am I already using?
- What free ADC pins do I have?
- Where is this pin physically located on my Nucleo board?
- What components have I connected?
- Which pins have special functions on the development board?

NucleoPin is designed to make those questions easier to answer while keeping STM32CubeMX as the configuration tool.

---

## Project Safety

NucleoPin does **not** modify your STM32CubeMX `.ioc` files.

The application reads the project configuration and stores its own project information separately.

This means you can continue using STM32CubeMX and STM32CubeIDE normally.

---

## Technology

NucleoPin is built with:

- Tauri 2
- Rust
- JavaScript
- HTML/CSS
- Vite

---

## Current Status

NucleoPin is under active development.

The current release focuses on the STM32 NUCLEO-F401RE and NUCLEO-F411RE and the workflow used when building and documenting projects around these boards.

Bug reports and suggestions are welcome through GitHub Issues.

---

## License

A license has not yet been specified for this project.

Until a license is added, the source code remains subject to normal copyright restrictions.
