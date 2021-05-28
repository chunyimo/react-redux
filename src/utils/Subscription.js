import { getBatch } from './batch'

// encapsulates the subscription logic for connecting a component to the redux store, as
// well as nesting subscriptions of descendant(子孙) components, so that we can ensure the
// ancestor components re-render before descendants

const nullListeners = { notify() {} }
/*
  data structure
  listener {
    callback: function
    prev: listener
    next: listener
  }
*/
function createListenerCollection() {
  const batch = getBatch()
  let first = null
  let last = null

  return {
    clear() {
      first = null
      last = null
    },
    // 执行listener
    notify() {
      batch(() => {
        let listener = first
        while (listener) {
          listener.callback()
          listener = listener.next
        }
      })
    },

    get() {
      let listeners = []
      let listener = first
      while (listener) {
        listeners.push(listener)
        listener = listener.next
      }
      return listeners
    },

    subscribe(callback) {
      let isSubscribed = true

      let listener = (last = {
        callback,
        next: null,
        prev: last,
      })

      if (listener.prev) {
        listener.prev.next = listener
      } else {
        first = listener
      }

      return function unsubscribe() {
        if (!isSubscribed || first === null) return
        isSubscribed = false

        if (listener.next) {
          listener.next.prev = listener.prev
        } else {
          last = listener.prev
        }
        if (listener.prev) {
          listener.prev.next = listener.next
        } else {
          first = listener.next
        }
      }
    },
  }
}
/**
 * 搜集所有被connect包裹的组件的更新函数onStateChange，
 * 然后形成一个callback链表，再由父级Subscription同一派发执行更新。
 *
 * 通过parentSub 可以形成一条subscription实例的链条。
 *
 * provider的Subscription是不存在parentSub，所以Provider内调用Subscription的时候，
 * trySubscribe 就会调用 store.subscribe
 *
 * @export
 * @class Subscription
 */
export default class Subscription {
  constructor(store, parentSub) {
    this.store = store
    // 获取来自父级的subscription实例，主要是在connect的时候可能会用到
    this.parentSub = parentSub
    this.unsubscribe = null
    this.listeners = nullListeners

    this.handleChangeWrapper = this.handleChangeWrapper.bind(this)
  }

  addNestedSub(listener) {
    // 通过this.unsubscribe是否有值判断该组件是否已经订阅，然后添加订阅者也就是listener
    this.trySubscribe()
    // 因为这里是被parentSub调用的，所以listener也会被订阅到parentSub上，
    // 也就是从Provider中获取的subscription
    return this.listeners.subscribe(listener)
  }
  // 向listeners发布通知
  notifyNestedSubs() {
    // 通知listeners 去执行
    this.listeners.notify()
  }

  handleChangeWrapper() {
    if (this.onStateChange) {
      // onStateChange会在外部的被实例化成subcription实例的时候，
      // 被赋值为不同的更新函数，被赋值的地方在Provider和connect中
      // 由于刚刚被订阅的函数就是handleChangeWrapper，
      // 而它也就相当于listener。所以当状态变化的时候，listener执行，onStateChange会执行
      this.onStateChange()
    }
  }

  isSubscribed() {
    return Boolean(this.unsubscribe)
  }

  trySubscribe() {
    if (!this.unsubscribe) {
      // parentSub实际上是subcription实例
      // 这里判断的是this.unsubscribe被赋值后的值，本质上也就是判断parentSub有没有，
      // 顺便再赋值给this.unsubscribe
      // 如果parentSub没传，那么使用store订阅，否则，
      // 调用context中获取的subscrption来订阅，保证都订阅到一个地方
      // ! this.store.subscribe(this.handleChangeWrapper) 由Provider 调用Subscription 触发，
      // ! 应该只会执行一次，所以只会在redux 添加一个subscription
      this.unsubscribe = this.parentSub
        ? this.parentSub.addNestedSub(this.handleChangeWrapper)
        : this.store.subscribe(this.handleChangeWrapper)

      this.listeners = createListenerCollection()
    }
  }

  tryUnsubscribe() {
    if (this.unsubscribe) {
      // 取消订阅
      this.unsubscribe()
      this.unsubscribe = null
      this.listeners.clear()
      this.listeners = nullListeners
    }
  }
}
