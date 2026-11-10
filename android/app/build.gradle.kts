plugins {
    id("com.android.application")
}

// NB TRX: a USB bridge for the web page of this repository (web/): the app takes the ESP32-S3 receiver and the ESP32-C3
// transmitter on USB OTG and serves the page with them to the browser on http://localhost:8080, as tools/web_bridge.py does
// on the PC. Android binds CDC-ACM devices to its own driver, so WebUSB cannot claim them, and Chrome has no Web Serial here.
android {
    namespace = "com.ok1cdj.nbtrx"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.ok1cdj.nbtrx"
        minSdk = 28                       // UsbDeviceConnection.requestWait(timeout)
        targetSdk = 36
        versionName = (findProperty("appVersion") as String?) ?: "0.1-dev"
        versionCode = (findProperty("appCode") as String?)?.toInt() ?: 1
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // the page itself: web/ of this repository goes into the APK's assets under web/
    sourceSets {
        getByName("main") { assets.srcDir("build/generated/webassets") }
    }
}

val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../web")) { exclude("test/**", "README.md") }
    into(layout.buildDirectory.dir("generated/webassets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }
