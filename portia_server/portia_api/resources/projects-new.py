from collections import OrderedDict
import json
import shutil
import zipfile

import chardet
from django.conf import settings
from django.utils.functional import cached_property
import requests
from dulwich.objects import Commit
from rest_framework.decorators import detail_route
from rest_framework.response import Response
from rest_framework.status import HTTP_200_OK, HTTP_201_CREATED
from six import iteritems
from scrapy.utils.misc import load_object

from django.http import HttpRequest
from portia_orm.models import Project
from storage import get_storage_class
from storage.backends import InvalidFilename
from .route import (JsonApiRoute, JsonApiModelRoute, CreateModelMixin,
                    ListModelMixin, RetrieveModelMixin)
from .response import FileResponse
from ..jsonapi.exceptions import (JsonApiFeatureNotAvailableError,
                                  JsonApiBadRequestError,
                                  JsonApiNotFoundError,
                                  JsonApiConflictError)
from ..utils.download import ProjectArchiver, CodeProjectArchiver
from ..utils.copy import ModelCopier, MissingModelException
from wsgiref.util import FileWrapper

from django.http.response import HttpResponse
import os
Deployer = load_object(settings.PROJECT_DEPLOYER)


class ProjectDownloadMixin(object):
    @detail_route(methods=['get'])
    def download(self, *args, **kwargs):
        fmt = self.query.get('format', 'spec')
        version = self.query.get('version', None)
        branch = self.query.get('branch', None)
        selector = self.query.get('selector') or 'css'
        spider_id = self.kwargs.get('spider_id', None)
        spiders = [spider_id] if spider_id is not None else None
        try:
            self.project
        except InvalidFilename as e:
            raise JsonApiNotFoundError(str(e))
        if hasattr(self.storage, 'checkout') and (version or branch):
            try:
                if version and len(version) < 40:
                    version = self.commit_from_short_sha(version).id
                self.storage.checkout(version, branch)
            except IOError:
                pass
            except ValueError as e:
                raise JsonApiNotFoundError(str(e))
        archiver = CodeProjectArchiver if fmt == u'code' else ProjectArchiver
        try:
            content = archiver(self.storage).archive(
                spiders, selector=selector)
            
        except IOError as e:
            raise JsonApiNotFoundError(str(e))
        try:
            name = u'{}.zip'.format(self.project.name)
        except UnicodeEncodeError:
            name = str(self.project.id)
   
        self.download_and_save_file(name, content)
        
        return Response(content)     
        return FileResponse(name, content, status=HTTP_200_OK)

    def download_and_save_file(self, name, content):
        save_path = "/data/zl_work/"+name
        with open(save_path, 'wb') as save_file:
            save_file.write(content.read())
        
        if os.path.exists(save_path):
            self.extract_files_from_zip(save_path, "/data/zl_work/project/")

        # 返回响应给客户端
        return Response(HTTP_200_OK)

    def extract_files_from_zip(self, zip_filepath, dest_path):
        with zipfile.ZipFile(zip_filepath, 'r') as zip_ref:
            zip_ref.extractall(dest_path)

    def commit_from_short_sha(self, version):
        for oid in self.storage.repo._repo.object_store:
            if oid.startswith(version):
                obj = self.storage.repo._repo.get_object(oid)
                if isinstance(obj, Commit):
                    return obj
        raise JsonApiNotFoundError(
            'Could not find commit for `{}`'.format(version)
        )


class BaseProjectRoute(JsonApiRoute):
    @cached_property
    def projects(self):
        storage_class = get_storage_class()
        return storage_class.get_projects(self.request.user)

    @cached_property
    def project(self):
        project_id = self.kwargs.get('project_id')
        try:
            name = self.projects[project_id]
            return Project(self.storage, id=project_id, name=name)
        except KeyError:
            raise JsonApiNotFoundError()


class BaseProjectModelRoute(BaseProjectRoute, JsonApiModelRoute):
    pass


class ProjectRoute(ProjectDownloadMixin, BaseProjectRoute,
                   ListModelMixin, RetrieveModelMixin, CreateModelMixin):
    lookup_url_kwarg = 'project_id'
    default_model = Project
    prefix_ip = 'http://10.0.1.40:27080'

    class FakeStorage(object):
        def exists(self, *args, **kwargs):
            return False

        def listdir(self, *args, **kwargs):
            return [], []

    def create(self, request):
        """Create a new project from the provided attributes"""
        try:
            name = self.data['data']['attributes']['name']
        except KeyError:
            raise JsonApiBadRequestError('No `name` provided')
        self.kwargs['project_id'] = name

        projects = self.projects
        if not self.storage.is_valid_filename(name) or '.' in name:
            raise JsonApiBadRequestError(
                '"{}" is not a valid project name,\nProject names may only '
                'contain letters and numbers'.format(name))
        if name in projects:
            raise JsonApiBadRequestError(
                'A project with the name "{}" already exists'.format(name))

        # Bootstrap project
        storage = self.storage
        storage.commit()

        project = Project(storage, id=name, name=name)
        serializer = self.get_serializer(project, storage=storage)
        data = serializer.data
        headers = self.get_success_headers(data)
        return Response(data, status=HTTP_201_CREATED, headers=headers)

    # def update(self):
    #     """Update an exiting project with the provided attributes"""

    # def destroy(self):
    #     """Delete the requested project"""

    @detail_route(methods=['get'])
    def status(self, *args, **kwargs):
        response = self.retrieve()
        data = OrderedDict()
        data.update({
            'meta': {
                'changes': self.get_project_changes()
            }
        })
        data.update(response.data)
        return Response(data, status=HTTP_200_OK)

    @detail_route(methods=['put', 'patch', 'post'])
    def publish(self, *args, **kwargs):
        if not self.storage.version_control and hasattr(self.storage, 'repo'):
            raise JsonApiFeatureNotAvailableError()

        if not self.get_project_changes():
            raise JsonApiBadRequestError('You have no changes to publish')

        force = self.query.get('force', False)
        branch = self.storage.branch
        published = self.storage.repo.publish_branch(branch, force=force)
        if not published:
            raise JsonApiConflictError(
                'A conflict occurred when publishing your changes.'
                'You must resolve the conflict before the project can be '
                'published.')
        self.deploy()
        self.storage.repo.delete_branch(branch)
        response = self.retrieve()
        return Response(response.data, status=HTTP_200_OK)


    @detail_route(methods=['GET'])
    def create_project(self, *args, **kwargs):
        auth = self.login()
        self.auth = auth
        
        current_url = self.path
        pathlist = current_url.split("/")
        pos = pathlist.index('projects')
        
        project = pathlist[pos + 1]

        url = self.prefix_ip+'/api/spiders'

        params = {
            "mode":"random",
            "priority":5,
            "name":str(project)+"_portia2",
            "col_name":"results_"+str(project)+"_portia",
            "cmd":"scrapy crawl "+str(project)
        }

        headers = {
            'Authorization': auth,
        }
        
        r = requests.post(url, headers=headers, data=json.dumps(params))
        return r.json()
    
    @detail_route(methods=['GET'])
    def login(self, *args, **kwargs):
        url = self.prefix_ip+'/api/login'
        params = {
            "username":"admin",
            "password":"admin",
        }
        r = requests.post(url, data=json.dumps(params))
        res = r.json()
        
        if res['message'] ==  'success':
            return res['data']
        return ''

    @detail_route(methods=['get'])
    def deploy2crawlab(self, *args, **kwargs):
        version = self.query.get('version', None)
        branch = self.query.get('branch', None)
        selector = self.query.get('selector') or 'css'
        spider_id = self.kwargs.get('spider_id', None)
        spiders = [spider_id] if spider_id is not None else None
        try:
            self.project
        except InvalidFilename as e:
            raise JsonApiNotFoundError(str(e))
        if hasattr(self.storage, 'checkout') and (version or branch):
            try:
                if version and len(version) < 40:
                    version = self.commit_from_short_sha(version).id
                self.storage.checkout(version, branch)
            except IOError:
                pass
            except ValueError as e:
                raise JsonApiNotFoundError(str(e))
        archiver = CodeProjectArchiver
        try:
            content = archiver(self.storage).archive(
                spiders, selector=selector)
            
        except IOError as e:
            raise JsonApiNotFoundError(str(e))
        try:
            name = u'{}.zip'.format(self.project.name)
        except UnicodeEncodeError:
            name = str(self.project.id)

        root_path = "/data/zl_work/"
        save_path = root_path+name
        dest_path = root_path+"project/"
        # 文件保存到服务器
        self.download_and_save_file(name, content, save_path, dest_path)
        # 创建项目
        create_res = self.create_project()
        self.idx = create_res['data']['_id']
        # 上传文件
        self.upload_portia_file(dest_path)
        # 删除临时创建文件
        if os.path.exists(root_path):
            shutil.rmtree(root_path)


        return Response(content)     
        return FileResponse(name, content, status=HTTP_200_OK)

    # 将zip文件保存到服务器
    def download_and_save_file(self, name, content, save_path, dest_path):
        with open(save_path, 'wb') as save_file:
            save_file.write(content.read())
        
        if os.path.exists(save_path):
            self.extract_files_from_zip(save_path, dest_path)
            # 将zip中文件提取至目标文件夹
            with zipfile.ZipFile(save_path, 'r') as zip_ref:
                zip_ref.extractall(dest_path)

        # 返回响应给客户端
        return Response(HTTP_200_OK)

    def upload_portia_file(self, dest_path):

        url = 'http://10.0.1.40:27080/api/spiders/'+self.idx+'/files/save'


        pathlist = self.list_files_and_dirs(dest_path)
        print(pathlist)
        for i in pathlist:
            with open(i[0], 'rb') as file:
                data = {
                    'path': i[1]
                }
                
                files = {'file': (i[1], file, 'multipart/form-data')}
                

                headers = {
                    'Accept': 'application/json, text/plain, */*',
                    'Authorization': self.auth,
                }

                r = requests.post(url, headers=headers, data=data, files=files)
                print(r.text)


    def list_files_and_dirs(self, root_dir):
        result = []
        for dirpath, dirnames, filenames in os.walk(root_dir):
            for filename in filenames:
                new_path = os.path.join(dirpath, filename)
                result.append([new_path, new_path.replace(root_dir, "").replace("\\", "/")])
        return result
        
    @detail_route(methods=['POST'])
    def deploy(self, *args, **kwargs):
        # data = self._deploy()
        return Response(HTTP_200_OK)

    @detail_route(methods=['put', 'patch', 'post'])
    def reset(self, *args, **kwargs):
        if not self.storage.version_control and hasattr(self.storage, 'repo'):
            raise JsonApiFeatureNotAvailableError()
        branch = self.storage.branch
        master = self.storage.repo.refs['refs/heads/master']
        self.storage.repo.refs['refs/heads/%s' % branch] = master
        return self.retrieve()

    @detail_route(methods=['post'])
    def copy(self, *args, **kwargs):
        from_project_id = self.query.get('from') or self.data.get('from')
        if not from_project_id:
            raise JsonApiBadRequestError('`from` parameter must be provided.')
        try:
            self.projects[from_project_id]
        except KeyError:
            raise JsonApiNotFoundError(
                'No project exists with the id "{}"'.format(from_project_id))
        models = self.data.get('data', [])
        if not models:
            raise JsonApiBadRequestError('No models provided to copy.')

        try:
            copier = ModelCopier(self.project, self.storage, from_project_id)
            copier.copy(models)
        except MissingModelException as e:
            raise JsonApiBadRequestError(
                'Could not find the following ids "{}" in the project.'.format(
                    '", "'.join(e.args[0])))
        response = self.retrieve()
        return Response(response.data, status=HTTP_201_CREATED)

    @detail_route(methods=['post'])
    def rollback(self, *args, **kwargs):
        if not self.storage.version_control and hasattr(self.storage, 'repo'):
            raise JsonApiFeatureNotAvailableError()
        version = self.query.get('version')
        branch = self.query.get('branch')
        if not (branch or version):
            raise JsonApiBadRequestError(
                'Need either `branch` or `version` arguments to rollback to')

        if branch:
            commit = self.storage.repo.refs['refs/heads/{}'.format(branch)]
        else:
            commit = self.commit_from_short_sha(version).id
        self.storage.repo.refs['refs/heads/master'] = commit
        self.storage.commit()
        self.deploy()
        return self.retrieve()

    def get_instance(self):
        return self.project

    def get_collection(self):
        storage = self.FakeStorage()
        return Project.collection(
            Project(storage, id=project_id, name=name)
            for project_id, name in iteritems(self.projects))

    def get_detail_kwargs(self):
        return {
            'include_data': [
                'spiders',
                'schemas',
            ],
            'fields_map': {
                'spiders': [
                    'project',
                ],
                'schemas': [
                    'name',
                    'default',
                    'project',
                ],
            },
            'exclude_map': {
                'projects': [
                    'extractors',
                ],
            }
        }

    def get_list_kwargs(self):
        return {
            'fields_map': {
                'projects': [
                    'name',
                ],
            }
        }

    def get_project_changes(self):
        storage = self.storage
        if not storage.version_control:
            raise JsonApiFeatureNotAvailableError()
        return [{'type': type_, 'path': path, 'old_path': old_path}
                for type_, path, old_path
                in storage.changed_files()]

    def _deploy(self):
        if settings.CAPABILITIES.get('deploy_projects'):
            return Deployer(self.project).deploy()
