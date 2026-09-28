# The bench firmware is built together with Motorcontrol's real StepGenerator,
# so the pulses come from the same gptimer ISR the shipped firmware uses rather
# than from a copy that could drift away from it.
FILE(GLOB app_sources ${CMAKE_SOURCE_DIR}/src/*.cpp)

idf_component_register(
    SRCS ${app_sources} "${CMAKE_SOURCE_DIR}/../../Motorcontrol/src/step_generator.cpp"
    INCLUDE_DIRS "." "${CMAKE_SOURCE_DIR}/../../Motorcontrol/src"
    REQUIRES driver esp_driver_gpio esp_driver_gptimer esp_driver_uart)
