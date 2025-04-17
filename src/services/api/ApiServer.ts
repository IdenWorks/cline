/**
 * ApiServer.ts
 *
 * Implements a simple REST API server to allow remote control of Cline tasks.
 * This is designed to work with container orchestration systems where each
 * container has a VS Code instance running the Cline extension.
 */

import * as vscode from "vscode"
import express, { Request, Response, NextFunction } from "express"
import * as http from "http"
import { Logger } from "../logging/Logger"

/**
 * API Server for remote control of Cline tasks
 */
export class ApiServer {
	private app: express.Application
	private server: http.Server | null = null
	private port: number = 3000
	private taskIdMap: Map<string, string> = new Map() // Map custom IDs to actual task IDs

	constructor() {
		this.app = express()
		this.app.use(express.json())
		this.setupRoutes()
	}

	/**
	 * Start the API server on the specified port
	 */
	public start(port: number = 3000): Promise<void> {
		this.port = port
		return new Promise((resolve, reject) => {
			try {
				this.server = this.app.listen(this.port, () => {
					Logger.log(`Cline API server started on port ${this.port}`)
					resolve()
				})
			} catch (error) {
				Logger.log(`Error starting Cline API server: ${error}`)
				reject(error)
			}
		})
	}

	/**
	 * Stop the API server if it's running
	 */
	public stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					Logger.log("Cline API server stopped")
					this.server = null
					resolve()
				})
			} else {
				resolve()
			}
		})
	}

	/**
	 * Set up the API routes
	 */
	private setupRoutes(): void {
		// Health check endpoint
		this.app.get("/api/health", (req: Request, res: Response) => {
			res.status(200).json({ status: "ok" })
		})

		// Start a new task
		this.app.post("/api/tasks/new", this.handleNewTask.bind(this))

		// Continue an existing task
		this.app.post("/api/tasks/continue", this.handleContinueTask.bind(this))
	}

	/**
	 * Handle new task creation requests
	 *
	 * This method creates a new Cline task with the provided description and optional images.
	 * It uses the cline.startNewTask command which:
	 * 1. Finds an active webview instance
	 * 2. Clears any existing task
	 * 3. Creates a new task with the provided description and images
	 * 4. Returns the generated task ID
	 *
	 * If a customId is provided, it will be mapped to the generated task ID for future reference.
	 */
	private async handleNewTask(req: Request, res: Response): Promise<void> {
		try {
			const { description, images, customId } = req.body

			if (!description) {
				res.status(400).json({ error: "Task description is required" })
				return
			}

			// Create a new task
			const taskId = (await vscode.commands.executeCommand("cline.startNewTask", {
				task: description,
				images: images || [],
			})) as string | null // Cast to string | null

			// If a custom ID was provided, store the mapping
			if (customId && taskId) {
				this.taskIdMap.set(customId, taskId)
			}

			res.status(200).json({
				success: true,
				taskId: taskId,
				customId: customId || undefined,
			})
		} catch (error) {
			Logger.log(`API error creating task: ${error}`)
			res.status(500).json({
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Handle continuing an existing task
	 *
	 * This method adds a new message to an existing Cline task identified by taskId or customId.
	 * It uses the cline.addMessageToTask command which:
	 * 1. Finds an active webview instance
	 * 2. Loads the specified task using showTaskWithId
	 * 3. Simulates a user sending a message by dispatching an askResponse message
	 * 4. Returns the task ID and success status
	 *
	 * This replicates the same flow that occurs when a user manually enters a message
	 * in the Cline UI for an existing task.
	 */
	private async handleContinueTask(req: Request, res: Response): Promise<void> {
		try {
			const { taskId, customId, message, images } = req.body

			if (!message) {
				res.status(400).json({ error: "Message is required" })
				return
			}

			// Determine which task ID to use
			let actualTaskId = taskId

			// If custom ID was provided, look up the actual task ID
			if (customId && !taskId && this.taskIdMap.has(customId)) {
				actualTaskId = this.taskIdMap.get(customId)!
			}

			if (!actualTaskId) {
				res.status(400).json({ error: "Valid taskId or customId is required" })
				return
			}

			// Continue the task with the new message using our new command
			const result = await vscode.commands.executeCommand("cline.addMessageToTask", {
				taskId: actualTaskId,
				message: message,
				images: images || [],
			})

			res.status(200).json({ success: true, result })
		} catch (error) {
			Logger.log(`API error continuing task: ${error}`)
			res.status(500).json({
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}

// Export a singleton instance
let apiServerInstance: ApiServer | null = null

/**
 * Start the API server for Cline
 */
export function startApiServer(port: number = 3000): Promise<void> {
	if (!apiServerInstance) {
		apiServerInstance = new ApiServer()
	}
	return apiServerInstance.start(port)
}

/**
 * Stop the API server if it's running
 */
export function stopApiServer(): Promise<void> {
	if (apiServerInstance) {
		return apiServerInstance.stop()
	}
	return Promise.resolve()
}
