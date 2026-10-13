#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
struct ApiConnection { url: String, token: String }

struct LocalService { child: Mutex<Child>, connection: ApiConnection }

impl Drop for LocalService {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            // Closing stdin asks the service to checkpoint and shut down.
            drop(child.stdin.take());
            for _ in 0..40 {
                if matches!(child.try_wait(), Ok(Some(_))) { return; }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn api_connection(service: tauri::State<'_, LocalService>) -> ApiConnection {
    service.connection.clone()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root = if cfg!(debug_assertions) {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
            } else { app.path().resource_dir()?.join("resources/runtime") };
            // Windows resource paths can use the extended \\?\ prefix. Node's
            // module resolver expects ordinary drive/UNC paths here.
            let root = dunce::simplified(&root).to_path_buf();
            let data_path = std::env::var_os("GRAPH_KB_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?);
            if !data_path.is_absolute() { return Err("GRAPH_KB_DATA_DIR 必须为绝对路径".into()); }
            let data = dunce::simplified(&data_path).to_path_buf();
            let node = if cfg!(debug_assertions) {
                std::path::PathBuf::from(std::env::var("GRAPH_KB_NODE").unwrap_or_else(|_| "node".into()))
            } else { root.join("node.exe") };
            let mut command = Command::new(node);
            command.arg(root.join("server/desktop.mjs")).arg(data)
                .current_dir(&root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let mut child = command.spawn()?;
            let stdout = child.stdout.take().ok_or("服务输出不可用")?;
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
                let _ = sender.send(result);
            });
            // First launch may migrate a legacy shared graph into separate libraries.
            let connection = receiver.recv_timeout(std::time::Duration::from_secs(120))
                .map_err(|error| error.to_string())
                .and_then(|line| line.map_err(|error| error.to_string()))
                .and_then(|line| serde_json::from_str::<ApiConnection>(&line).map_err(|error| error.to_string()));
            match connection {
                Ok(connection) => { app.manage(LocalService { child: Mutex::new(child), connection }); }
                Err(error) => {
                    let _ = child.kill(); let _ = child.wait();
                    return Err(format!("本地图库服务启动失败: {error}").into());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_connection])
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}
