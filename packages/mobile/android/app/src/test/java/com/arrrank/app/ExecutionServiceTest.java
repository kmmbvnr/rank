package com.arrrank.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ExecutionServiceTest {

    @Test
    public void testIsExecutionActive() {
        assertTrue(ExecutionService.isExecutionActive("running"));
        assertTrue(ExecutionService.isExecutionActive("paused"));
        assertTrue(ExecutionService.isExecutionActive("turbo"));
        assertFalse(ExecutionService.isExecutionActive("idle"));
        assertFalse(ExecutionService.isExecutionActive("stopped"));
        assertFalse(ExecutionService.isExecutionActive(null));
        assertFalse(ExecutionService.isExecutionActive(""));
    }

    @Test
    public void testActionConstants() {
        assertEquals("com.arrrank.app.action.UPDATE_STATE", ExecutionService.ACTION_UPDATE_STATE);
        assertEquals("com.arrrank.app.action.PAUSE", ExecutionService.ACTION_PAUSE);
        assertEquals("com.arrrank.app.action.RESUME", ExecutionService.ACTION_RESUME);
        assertEquals("com.arrrank.app.action.STOP", ExecutionService.ACTION_STOP);
    }
}
