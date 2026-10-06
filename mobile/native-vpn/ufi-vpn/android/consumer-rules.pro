# The app does not record VPN configurations, keys, destinations, or traffic logs.
# Remove the embedded library's optional Android log calls from minified releases.
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}
