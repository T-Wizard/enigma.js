import Promise from 'bluebird';
import Session from '../../src/session';
import SuspendResume from '../../src/suspend-resume';
import ApiCache from '../../src/api-cache';
import RPCMock from '../mocks/rpc-mock';
import SocketMock from '../mocks/socket-mock';

describe('Session', () => {
  let session;
  let sandbox;
  let suspendResume;
  let apis;

  const intercept = { execute: promise => promise };
  const createSession = (throwError, rpc, suspendOnClose = false) => {
    const defaultRpc = new RPCMock({
      Promise,
      url: 'http://localhost:4848',
      createSocket: url => new SocketMock(url, throwError),
    });
    apis = new ApiCache();
    suspendResume = new SuspendResume({ Promise, rpc: rpc || defaultRpc, apis });
    session = new Session({
      Promise,
      apis,
      suspendResume,
      suspendOnClose,
      intercept,
      rpc: rpc || defaultRpc,
      protocol: { delta: true },
    });
  };

  beforeEach(() => {
    createSession();
    sandbox = sinon.sandbox.create();
    SocketMock.on('created', socket => socket.open());
  });

  afterEach(() => {
    sandbox.restore();
    SocketMock.removeAllListeners();
  });

  it('should be a constructor', () => {
    expect(Session).to.be.a('function');
    expect(Session).to.throw();
  });

  it('should return a promise when open is called', () => {
    session.getObjectApi = () => {};
    const open = session.open();
    const anotherOpen = session.open();
    expect(open).to.be.an.instanceOf(Promise);
    expect(anotherOpen).to.equal(open);
  });

  it("should call reject callback if connection can't be established", (done) => {
    createSession(true);
    session.open().then(() => {}, () => { done(); });
  });

  it("should call catch reject callback if connection can't be established", (done) => {
    createSession(true);
    session.open().catch(() => { done(); });
  });

  describe('listeners', () => {
    it('should call notification listeners', () => {
      const event = 'notification:Foo';
      const spy = sandbox.spy();
      session.on(event, spy);
      session.emit(event, { prop: 'foo' });
      expect(spy).to.have.been.calledWithExactly({ prop: 'foo' });
    });

    it('should emit the opened and closed events', () => {
      const openedCallback = sinon.spy();
      const closedCallback = sinon.spy();
      session.on('opened', openedCallback);
      session.on('closed', closedCallback);
      session.getObjectApi = () => {};
      return session.open()
        .then(() => expect(openedCallback.calledOnce).to.equal(true))
        .then(() => session.close())
        .then(() => expect(closedCallback.calledOnce).to.equal(true));
    });
  });

  describe('send', () => {
    it("should throw when trying to send a message if connection isn't established", () => {
      expect(session.send).to.throw();
    });

    it('should call `addToPromiseChain` for `requestId`', () => {
      const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
      createSession(false, rpc);
      sinon.stub(rpc, 'send', (data) => {
        data.id = 1;
        return Promise.resolve(data);
      });

      const fn = sandbox.stub(Session, 'addToPromiseChain');
      const request = {};
      return session.send(request).then(() => {
        expect(request).to.have.property('id', 1);
        expect(fn).to.have.been.calledWithExactly(sinon.match.object, 'requestId', 1);
      });
    });

    it('should only pass on known properties to rpc.send', () => {
      const validPorperties = ['method', 'handle', 'params', 'delta', 'cont', 'id', 'jsonrpc', 'return_empty'];
      function isValid(data) {
        return Object.keys(data).every(key => validPorperties.indexOf(key) !== -1);
      }

      const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
      createSession(false, rpc);

      const send = sinon.spy(rpc, 'send');

      session.send({ method: 'a', handle: 1, params: [], delta: true, xyz: 'xyz' });
      expect(send).to.have.been.calledWithExactly({ method: 'a', handle: 1, params: [], delta: true });
      expect(send).to.have.been.calledWithExactly(sinon.match(isValid));
    });

    it('should return response argument if qHandle/qType are undefined', () => {
      const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
      createSession(false, rpc);
      sinon.stub(rpc, 'send', (data) => {
        data.id = 1;
        return Promise.resolve({ message: 'hello!' });
      });

      const request = {};
      return session.send(request).then((response) => {
        expect(response).to.deep.equal({ message: 'hello!' });
      });
    });

    it('should add additional protocol parameters to request object', () => {
      const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
      createSession(false, rpc);
      session.protocol.foo = 'bar';

      const send = sinon.spy(rpc, 'send');

      return session.send({ method: 'a', handle: 1, params: [], delta: true, xyz: 'xyz' })
        .then(() => expect(send.lastCall.args[0].foo).to.equal('bar'));
    });

    it('should honor delta blacklist', () => {
      const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
      createSession(false, rpc);
      session.protocol.delta = true;

      const send = sinon.spy(rpc, 'send');

      return session.send({ method: 'a', handle: 1, params: [], delta: false, xyz: 'xyz' })
        .then(() => expect(send.lastCall.args[0].delta).to.equal(false));
    });
  });

  it('should listen to notification and message', () => {
    const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
    const rpcSpy = sinon.spy(rpc, 'on');
    createSession(false, rpc);
    expect(rpcSpy).to.have.been.calledWith('notification', sinon.match.func);
    expect(rpcSpy).to.have.been.calledWith('message', sinon.match.func);
  });

  it('should emit notification:method from rpc', () => {
    const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
    createSession(false, rpc);
    const spy = sinon.spy(session, 'emit');
    rpc.emit('notification', { method: 'FooBar', params: { prop: 'bar' } });
    expect(spy).to.have.been.calledWith('notification:FooBar', { prop: 'bar' });
  });

  it('should emit notifications:* from rpc', () => {
    const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
    createSession(false, rpc);
    const spy = sinon.spy(session, 'emit');
    rpc.emit('notification', { method: 'Foo', params: { prop: 'foo' } });
    rpc.emit('notification', { method: 'FooBar', params: { prop: 'bar' } });
    expect(spy.firstCall).to.have.been.calledWithExactly('notification:*', 'Foo', { prop: 'foo' });
    expect(spy.thirdCall).to.have.been.calledWithExactly('notification:*', 'FooBar', { prop: 'bar' });
  });

  it('should process message from rpc', () => {
    const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
    createSession(false, rpc);
    session.removeAllListeners();

    const changeSpy = sinon.spy();
    session.on('handle:changed', changeSpy);

    rpc.emit('message', { change: [1, 2, 3] });
    expect(changeSpy.calledThrice).to.equal(true);

    const closeSpy = sinon.spy();
    session.on('handle:closed', closeSpy);

    rpc.emit('message', { close: [1, 2, 3] });
    expect(closeSpy.calledThrice).to.equal(true);
  });

  it('should emit socket error', () => {
    const rpc = new RPCMock(Promise, SocketMock, 'http://localhost:4848', {});
    createSession(false, rpc);
    const emit = sinon.spy(session, 'emit');
    rpc.emit('socket-error', 'fubar');
    expect(emit).to.have.been.calledWith('socket-error', 'fubar');
  });


  it('should close', () => {
    const rpc = new RPCMock({ Promise, url: 'http://localhost:4848', createSocket: url => new SocketMock(url) });
    createSession(false, rpc);
    session.getObjectApi = () => {};
    session.open();
    const close = sinon.spy(rpc, 'close');
    const closePromise = session.close();
    expect(closePromise).to.be.an.instanceOf(Promise);
    expect(close.calledOnce).to.equal(true);
  });

  describe('addToPromiseChain', () => {
    it('should add value on promise', () => {
      const promise = Promise.resolve();
      Session.addToPromiseChain(promise, 'foo', 'bar');
      expect(promise.foo).to.equal('bar');
    });

    it('should add value to chained promise', () => {
      const promise = Promise.resolve();
      Session.addToPromiseChain(promise, 'foo', 'bar');
      const p1 = promise.then();
      const p2 = p1.then();
      expect(p1.foo).to.equal('bar');
      expect(p2.foo).to.equal('bar');
    });

    it('should chain as normal', () => {
      const promise = Promise.resolve('baz');
      Session.addToPromiseChain(promise, 'foo', 'bar');
      const p1 = promise.then(s => `${s}1`);
      return expect(p1).to.eventually.equal('baz1');
    });
  });

  describe('suspend/resume', () => {
    it('should reject send() calls during suspended state', () => {
      suspendResume.isSuspended = true;
      expect(session.send()).to.eventually.be.rejectedWith('Session suspended');
    });

    it('should not trigger events during suspended state', () => {
      suspendResume.isSuspended = true;
      const spy = sinon.spy();
      session.on('socket-error', spy);
      session.on('suspended', spy);
      session.on('closed', spy);
      session.on('handle:changed', spy);
      session.on('handle:closed', spy);
      session.onError();
      session.onClosed();
      session.onMessage();
      expect(spy.callCount).to.equal(0);
    });

    it('should close socket and emit suspended', () => {
      const spy = sinon.spy();
      const stub = sinon.stub(session.rpc, 'close').returns(Promise.resolve());
      session.on('suspended', spy);
      return session.suspend().then(() => {
        expect(suspendResume.isSuspended).to.equal(true);
        expect(stub.calledOnce).to.equal(true);
        expect(spy.calledOnce).to.equal(true);
      });
    });

    it('should set session as suspended when suspendOnClose is true', () => {
      createSession(false, null, true);
      apis.add(-1, {});
      const spy = sinon.spy();
      session.on('suspended', spy);
      return session.open()
        .then(() => session.rpc.close(9999))
        .then(() => {
          expect(suspendResume.isSuspended).to.equal(true);
          expect(spy.callCount).to.equal(1);
        });
    });

    it('should open socket and emit resumed', () => {
      const spy = sinon.spy();
      suspendResume.isSuspended = true;
      suspendResume.resume = () => Promise.resolve();
      session.on('resumed', spy);
      return session.resume().then(() => {
        expect(spy.calledOnce).to.equal(true);
      });
    });
  });

  describe('getObjectApi', () => {
    it('should return an existing api', () => {
      const cacheEntry = {
        Foo: 'bar',
      };
      apis.add(-1, cacheEntry);
      const api = session.getObjectApi({ handle: -1, id: 'id_1234', type: 'Foo', genericType: 'Bar' });
      expect(api).to.equal(cacheEntry);
    });

    it('should create and return an api', () => {
      const create = sinon.stub();
      const generate = sinon.stub().returns({ create });
      session.definition = { generate };
      session.getObjectApi({ handle: -1, id: 'id_1234', type: 'Foo', genericType: 'Bar' });
      expect(generate).to.be.calledWith('Foo');
      expect(create).to.be.calledWith(session, -1, 'id_1234', true, 'Bar');
    });
  });
});