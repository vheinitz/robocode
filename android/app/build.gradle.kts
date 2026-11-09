plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "de.robocode"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.robocode"
        minSdk = 24          // USB-Host
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // USB-Serial (CDC-ACM) für die OTG-Verbindung zum ESP32 (Flash + REPL).
    implementation("com.github.mik3y:usb-serial-for-android:3.7.0")
}
