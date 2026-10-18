import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const harnessSchema = z.object({
	dispatch: z.function({ input: z.tuple([z.unknown()]), output: z.promise(z.unknown()) }),
	stats: z.function({
		input: z.tuple([]),
		output: z.object({
			foreground: z.number(),
			userTab: z.number(),
			windowState: z.string(),
			removed: z.array(z.number()),
			inputs: z.number(),
			tabWindow: z.number(),
		}),
	}),
	move: z.function({ input: z.tuple([]), output: z.void() }),
	reveal: z.function({ input: z.tuple([]), output: z.void() }),
});

async function harness(navigateAfterClick = false) {
	const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
	// Chrome is the external boundary. Execute the shipped worker, substituting
	// only its SDK and page-runtime import; authentication is tested by bridge tests.
	const script = new Script(`
		const pageRuntime = () => {};
		let foreground=50, userTab=70, tabWindow=50, inputs=0;
		let contextId=0, debuggerListener;
		const removed=[];
		const window={id:10,focused:false,state:'minimized',tabs:[{id:99}]};
		const event={addListener(){},removeListener(){}};
		const chrome={
			storage:{local:{get:async()=>({}),set:async()=>{}},session:{set:async()=>{}},onChanged:event},
			runtime:{sendNativeMessage:async()=>{throw Error('No host')},onMessage:event},
			alarms:{create(){},onAlarm:event},
			windows:{
				create:async(options)=>{window.state=options.state;if(options.focused)foreground=10;return window;},
				get:async()=>window,update:async(_id,options)=>{window.state=options.state;return window},
				remove:async()=>{},onRemoved:event,onFocusChanged:event,onBoundsChanged:event
			},
			tabs:{
				create:async(options)=>{
					tabWindow=options.windowId??50;
					if(options.active&&tabWindow===50)userTab=100;
					return {id:100,windowId:tabWindow,url:options.url};
				},
				get:async()=>({id:100,windowId:tabWindow,status:'complete'}),
				remove:async(id)=>{removed.push(id)},
				update:async()=>{},onUpdated:event,onRemoved:event,onAttached:event
			},
			debugger:{
				attach:async()=>{},
				sendCommand:async(_target,method,params)=>{
					if(method.startsWith('Input.'))inputs++;
					if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'&&${navigateAfterClick})
						debuggerListener({tabId:100},'Runtime.executionContextsCleared');
					if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame'}}};
					if(method==='Page.createIsolatedWorld'){contextId++;return {executionContextId:1};}
					if(method==='Runtime.evaluate'&&params.expression.includes('"method":"observe"'))
						return {result:{value:{revision:'document'+contextId,rows:[]}}};
					if(method==='Runtime.evaluate'&&params.expression.includes('"method":"target"'))
						return {result:{value:{x:10,y:10}}};
					return {};
				},
				onEvent:{addListener(listener){debuggerListener=listener}},onDetach:event
			}
		};
		const WebSocket={OPEN:1};
		${source.replace(/^import .*$/m, "")}
		ready=true;stopped=false;socket={readyState:1,send(raw){
			const packet=JSON.parse(raw);
			if(packet.event==='checkpoint'){
				const waiter=checkpoints.get(packet.id);
				clearTimeout(waiter.timer);
				checkpoints.delete(packet.id);
				waiter.resolve(true);
			}
		}};
		({
			dispatch,
			stats:()=>({foreground,userTab,windowState:window.state,removed,inputs,tabWindow}),
			move:()=>{tabWindow=50},
			reveal:()=>{window.focused=true;window.state='normal'}
		})
	`);
	const value: unknown = script.runInNewContext({ setTimeout, clearTimeout, setInterval, clearInterval, URL });
	return harnessSchema.parse(value);
}

describe("background worker ownership", () => {
	it("#given a user window #when opening a page #then keeps the user window and tab unchanged", async () => {
		const worker = await harness();
		await worker.dispatch({ command: "open", url: "https://example.com" });
		expect(worker.stats()).toMatchObject({
			foreground: 50,
			userTab: 70,
			tabWindow: 10,
			windowState: "minimized",
			removed: [],
		});
	});

	it("#given a tab moved into a user window #when closing #then refuses to remove it", async () => {
		const worker = await harness();
		await worker.dispatch({ command: "open", url: "https://example.com" });
		worker.move();
		await expect(worker.dispatch({ command: "close", tabId: 100 })).rejects.toBeDefined();
		expect(worker.stats().removed).toEqual([]);
	});

	it("#given a revealed agent window #when running input #then refuses before dispatch", async () => {
		const worker = await harness();
		await worker.dispatch({ command: "open", url: "https://example.com" });
		worker.reveal();
		await expect(worker.dispatch({ command: "run", tabId: 100 })).rejects.toBeDefined();
		expect(worker.stats().inputs).toBe(0);
	});

	it("#given navigation during a batch #when continuing #then refuses refs from the previous document", async () => {
		const worker = await harness(true);
		await worker.dispatch({ command: "open", url: "https://example.com" });
		await expect(
			worker.dispatch({
				command: "run",
				id: "navigation",
				tabId: 100,
				revision: "document1",
				limits: { maxChars: 6000, maxElements: 80, fullPage: false },
				steps: [
					{ action: "click", ref: 1 },
					{ action: "click", ref: 1 },
				],
			}),
		).rejects.toBeDefined();
		expect(worker.stats().inputs).toBe(2);
	});

	it("#given one document #when running a batch #then completes both grounded clicks", async () => {
		const worker = await harness();
		await worker.dispatch({ command: "open", url: "https://example.com" });
		await expect(
			worker.dispatch({
				command: "run",
				id: "same-document",
				tabId: 100,
				revision: "document1",
				limits: { maxChars: 6000, maxElements: 80, fullPage: false },
				steps: [
					{ action: "click", ref: 1 },
					{ action: "click", ref: 1 },
				],
			}),
		).resolves.toMatchObject({ completedSteps: 2 });
		expect(worker.stats().inputs).toBe(4);
	});
});
