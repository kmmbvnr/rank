package com.arrrank.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Foreground service that maintains an ongoing notification and prevents process
 * termination during long-running evaluation or when the app is backgrounded.
 */
public class ExecutionService extends Service {
    public static final String ACTION_UPDATE_STATE = "com.arrrank.app.action.UPDATE_STATE";
    public static final String ACTION_PAUSE = "com.arrrank.app.action.PAUSE";
    public static final String ACTION_RESUME = "com.arrrank.app.action.RESUME";
    public static final String ACTION_STOP = "com.arrrank.app.action.STOP";

    public static final String EXTRA_STATE = "extra_state";
    public static final String CHANNEL_ID = "rank_execution_channel";
    public static final int NOTIFICATION_ID = 1001;
    private static final long DELAY_FOREGROUND_MS = 3000;

    private static volatile String currentState = "idle";
    private static volatile boolean isForeground = false;
    private static Handler handler;
    private static synchronized Handler getHandler() {
        if (handler == null) {
            handler = new Handler(Looper.getMainLooper());
        }
        return handler;
    }
    private static final Runnable startForegroundRunnable = () -> {
        MainActivity activity = MainActivity.getCurrentActivity();
        if (activity != null && isExecutionActive(currentState)) {
            startService(activity, currentState);
        }
    };

    public static boolean isExecutionActive(String state) {
        return "running".equals(state) || "paused".equals(state) || "turbo".equals(state);
    }

    public static String getCurrentState() {
        return currentState;
    }

    public static boolean isRunningForeground() {
        return isForeground;
    }

    public static synchronized void updateState(Context context, String state) {
        currentState = state != null ? state : "idle";
        getHandler().removeCallbacks(startForegroundRunnable);

        if (!isExecutionActive(currentState)) {
            stop(context);
            return;
        }

        if (isForeground) {
            startService(context, currentState);
        } else {
            MainActivity activity = MainActivity.getCurrentActivity();
            if (activity == null || !activity.isAppResumed()) {
                startService(context, currentState);
            } else {
                getHandler().postDelayed(startForegroundRunnable, DELAY_FOREGROUND_MS);
            }
        }
    }

    public static synchronized void onAppBackgrounded(Context context) {
        if (handler != null) handler.removeCallbacks(startForegroundRunnable);
        if (isExecutionActive(currentState)) {
            startService(context, currentState);
        }
    }

    public static synchronized void stop(Context context) {
        if (handler != null) handler.removeCallbacks(startForegroundRunnable);
        currentState = "idle";
        if (isForeground) {
            Intent intent = new Intent(context, ExecutionService.class);
            context.stopService(intent);
            isForeground = false;
        }
    }

    private static void startService(Context context, String state) {
        Intent intent = new Intent(context, ExecutionService.class);
        intent.setAction(ACTION_UPDATE_STATE);
        intent.putExtra(EXTRA_STATE, state);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // ForegroundServiceStartNotAllowedException on Android 12+ if background restricted
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PAUSE.equals(action)) {
                MainActivity.pauseExecution();
                currentState = "paused";
                updateNotification("paused");
                return START_NOT_STICKY;
            } else if (ACTION_RESUME.equals(action)) {
                MainActivity.resumeExecution();
                currentState = "running";
                updateNotification("running");
                return START_NOT_STICKY;
            } else if (ACTION_STOP.equals(action)) {
                MainActivity.stopExecution();
                currentState = "idle";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE);
                } else {
                    stopForeground(true);
                }
                stopSelf();
                return START_NOT_STICKY;
            } else if (ACTION_UPDATE_STATE.equals(action)) {
                String state = intent.getStringExtra(EXTRA_STATE);
                if (state != null) currentState = state;
                if (!isExecutionActive(currentState)) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        stopForeground(STOP_FOREGROUND_REMOVE);
                    } else {
                        stopForeground(true);
                    }
                    stopSelf();
                    return START_NOT_STICKY;
                }
            }
        }

        ensureNotificationChannel();
        Notification notification = buildNotification(currentState);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isForeground = true;
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        isForeground = false;
        if (handler != null) handler.removeCallbacks(startForegroundRunnable);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stop(this);
        super.onTaskRemoved(rootIntent);
    }

    private void updateNotification(String state) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(state));
        }
    }

    private Notification buildNotification(String state) {
        boolean isPaused = "paused".equals(state);
        boolean isTurbo = "turbo".equals(state);
        String text = isPaused ? "Evaluation paused" : (isTurbo ? "Running in turbo…" : "Running evaluation…");

        Intent tapIntent = new Intent(this, MainActivity.class);
        tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tapPending = PendingIntent.getActivity(this, 0, tapIntent, flags);

        int actionIcon;
        String actionTitle;
        String actionCommand;

        if (isPaused) {
            actionIcon = android.R.drawable.ic_media_play;
            actionTitle = "Resume";
            actionCommand = ACTION_RESUME;
        } else if (isTurbo) {
            actionIcon = android.R.drawable.ic_menu_close_clear_cancel;
            actionTitle = "Stop";
            actionCommand = ACTION_STOP;
        } else {
            actionIcon = android.R.drawable.ic_media_pause;
            actionTitle = "Pause";
            actionCommand = ACTION_PAUSE;
        }

        Intent actionIntent = new Intent(this, ExecutionService.class);
        actionIntent.setAction(actionCommand);
        PendingIntent actionPending = PendingIntent.getService(this, 1, actionIntent, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder.setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tapPending);

        Notification.Action action = new Notification.Action.Builder(
            Icon.createWithResource(this, actionIcon),
            actionTitle,
            actionPending
        ).build();
        builder.addAction(action);

        Notification.MediaStyle mediaStyle = new Notification.MediaStyle();
        mediaStyle.setShowActionsInCompactView(0);
        builder.setStyle(mediaStyle);

        return builder.build();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Rank Execution",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Notifications for ongoing and paused computations");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }
        }
    }
}
