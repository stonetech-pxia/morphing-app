# ML Kit 各个库都带一份改了名的内部类，靠组件注册在运行时连起来。release 包开了 R8，
# 会把这些类合并、改写，结果在手机上空指针（例如语言识别读到另一个库的类）。整个 ML Kit 不让 R8 动。
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
# ONNX Runtime（D-269）：原生代码按名字找 Java 类和方法，R8 不能改名或删掉。
-keep class ai.onnxruntime.** { *; }
# ML Kit 实体识别（预填日期和金额）带进了 WorkManager：它用 Room 按名字反射创建 WorkDatabase_Impl，
# R8 删掉后 App 一启动就崩（Failed to create an instance of androidx.work.impl.WorkDatabase）。
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
