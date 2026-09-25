#pragma once
/**
 * @file keypad_task.h
 * @brief Runs the keypad scan on its own task and hands events to the main loop.
 */
#include "key_event.h"
#include "keypad.h"

/**
 * @brief Start the scan task.
 * @param keypad Driver to scan with. Must already be begun and must outlive the task.
 * @return false if the queue or the task could not be created.
 */
bool keypad_task_start(vmaas::Keypad& keypad);

/**
 * @brief Take one event from the queue without blocking.
 * @param out Filled in when an event was waiting.
 * @return false when the queue is empty.
 */
bool keypad_task_next(vmaas::KeyEvent& out);
