package com.shohag.luna;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Phone actions for Luna. Nothing here acts on its own:
 *  - openApp opens an installed app the user asked for,
 *  - findContact reads contacts on the device only to match a spoken name (nothing is uploaded),
 *  - dial opens the dialer with the number (the user presses call),
 *  - compose opens the SMS / WhatsApp screen with the text prefilled (the user presses send).
 */
@CapacitorPlugin(
    name = "LunaPhone",
    permissions = { @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts") }
)
public class LunaPhonePlugin extends Plugin {

    // ---------- Open app ----------
    @PluginMethod
    public void openApp(PluginCall call) {
        String query = call.getString("name", "");
        if (query == null || query.trim().isEmpty()) {
            call.reject("name missing");
            return;
        }
        String q = query.trim().toLowerCase(Locale.ROOT);
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN, null);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);

        ResolveInfo best = null;
        int bestScore = 0;
        List<String> names = new ArrayList<>();
        for (ResolveInfo ri : apps) {
            String label = String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.ROOT);
            String pkg = ri.activityInfo.packageName.toLowerCase(Locale.ROOT);
            int score = 0;
            if (label.equals(q)) score = 100;
            else if (label.startsWith(q)) score = 80;
            else if (label.contains(q)) score = 60;
            else if (pkg.contains(q.replace(" ", ""))) score = 40;
            if (score > 0) {
                names.add(String.valueOf(ri.loadLabel(pm)));
                if (score > bestScore) {
                    bestScore = score;
                    best = ri;
                }
            }
        }
        JSObject ret = new JSObject();
        if (best == null) {
            ret.put("opened", false);
            ret.put("reason", "not_found");
            call.resolve(ret);
            return;
        }
        Intent launch = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (launch == null) {
            ret.put("opened", false);
            ret.put("reason", "cannot_launch");
            call.resolve(ret);
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(launch);
        ret.put("opened", true);
        ret.put("app", String.valueOf(best.loadLabel(pm)));
        ret.put("matches", names.size());
        call.resolve(ret);
    }

    // ---------- Open a link (YouTube/Maps/Play links open in their own app when installed) ----------
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("https://") || url.startsWith("market://"))) {
            call.reject("bad url");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            call.reject("cannot open");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }

    // ---------- Contacts ----------
    @PluginMethod
    public void findContact(PluginCall call) {
        if (getPermissionState("contacts") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
            return;
        }
        doFindContact(call);
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        if (getPermissionState("contacts") == com.getcapacitor.PermissionState.GRANTED) {
            doFindContact(call);
        } else {
            JSObject ret = new JSObject();
            ret.put("permission", "denied");
            ret.put("contacts", new JSArray());
            call.resolve(ret);
        }
    }

    private void doFindContact(PluginCall call) {
        String name = call.getString("name", "");
        JSArray out = new JSArray();
        if (name != null && !name.trim().isEmpty()) {
            String like = "%" + name.trim() + "%";
            Cursor c = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] {
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                },
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?",
                new String[] { like },
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );
            if (c != null) {
                try {
                    java.util.HashSet<String> seen = new java.util.HashSet<>();
                    while (c.moveToNext() && out.length() < 5) {
                        String n = c.getString(0);
                        String num = c.getString(1);
                        String digits = num == null ? "" : num.replaceAll("[^0-9+]", "");
                        if (digits.isEmpty() || !seen.add(n + "|" + digits)) continue;
                        JSObject o = new JSObject();
                        o.put("name", n);
                        o.put("number", num);
                        out.put(o);
                    }
                } finally {
                    c.close();
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("permission", "granted");
        ret.put("contacts", out);
        call.resolve(ret);
    }

    // ---------- Dialer (user presses the call button) ----------
    @PluginMethod
    public void dial(PluginCall call) {
        String number = call.getString("number", "");
        if (number == null || number.trim().isEmpty()) {
            call.reject("number missing");
            return;
        }
        Intent i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number.trim())));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }

    // ---------- Message draft (user presses send) ----------
    @PluginMethod
    public void compose(PluginCall call) {
        String number = call.getString("number", "");
        String text = call.getString("text", "");
        String via = call.getString("via", "sms");
        if (number == null || number.trim().isEmpty()) {
            call.reject("number missing");
            return;
        }
        Intent i;
        if ("whatsapp".equals(via)) {
            String digits = number.replaceAll("[^0-9]", "");
            if (digits.startsWith("01") && digits.length() == 11) digits = "880" + digits.substring(1); // Bangladesh local format
            i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + digits + "?text=" + Uri.encode(text == null ? "" : text)));
        } else {
            i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number.trim())));
            i.putExtra("sms_body", text == null ? "" : text);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            call.reject("cannot open " + via);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("opened", true);
        call.resolve(ret);
    }
}
